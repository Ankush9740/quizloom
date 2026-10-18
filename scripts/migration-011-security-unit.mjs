import assert from "node:assert/strict";
import fs from "node:fs";

const migration010 = fs.readFileSync("supabase/migrations/010_authorized_transition_hydration.sql", "utf8");
const migration011 = fs.readFileSync("supabase/migrations/011_fix_authorized_transition_hydration.sql", "utf8");
const verifier = fs.readFileSync("scripts/verify-migration-011.mjs", "utf8");

function normalizeSql(value) {
  return value.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
}

assert.match(migration011, /^begin;[\s\S]*commit;\s*$/i, "migration 011 must remain transactional");
assert.doesNotMatch(migration011, /\bregistrations\b/i, "migration 011 must not access the unrelated registrations table");
assert.doesNotMatch(migration011, /\b(?:truncate|drop\s+table|delete\s+from|update\s+public\.)\b/i, "migration 011 must only replace the function and its permissions");
assert.equal((migration011.match(/security definer/gi) ?? []).length, 1);
assert.equal((migration011.match(/set search_path = ''/gi) ?? []).length, 1);
assert.match(migration011, /create or replace function public\.get_authorized_quiz_room_transition\s*\(/i);

const expectedHotfix = migration010.replace("pg_catalog.coalesce(", "coalesce(");
assert.equal(
  normalizeSql(migration011),
  normalizeSql(expectedHotfix),
  "migration 011 must preserve Migration 010 except for the invalid pg_catalog.coalesce qualifier"
);
assert.doesNotMatch(migration011, /pg_catalog\.coalesce\s*\(/i, "COALESCE is SQL syntax and cannot be schema-qualified");
assert.match(migration011, /select\s+coalesce\s*\([\s\S]*pg_catalog\.jsonb_agg[\s\S]*'\[\]'::jsonb[\s\S]*\)\s+into\s+v_options/i);

const allowedCatalogFunctions = new Set(["jsonb_agg", "jsonb_build_object"]);
for (const [, name] of migration011.matchAll(/pg_catalog\.([a-z_][a-z0-9_]*)\s*\(/gi)) {
  assert.ok(allowedCatalogFunctions.has(name.toLowerCase()), `unexpected schema-qualified SQL construct: pg_catalog.${name}`);
}

for (const relation of ["public.game_rooms", "public.room_secrets", "public.players", "public.player_secrets", "public.questions", "public.question_options"]) {
  assert.match(migration011, new RegExp(relation.replace(".", "\\.")), `migration 011 must qualify ${relation}`);
}
assert.ok(migration011.indexOf("if not v_authorized then") < migration011.indexOf("from public.questions question"), "question content must not be loaded before authorization succeeds");
assert.doesNotMatch(migration011, /\bis_correct\b|correctOptionId|correct_option|score|streak|session_token/i, "transition hydration must not expose correctness or sensitive player data");
assert.match(migration011, /revoke all on function public\.get_authorized_quiz_room_transition[\s\S]*from public, anon, authenticated/i);
assert.match(migration011, /grant execute on function public\.get_authorized_quiz_room_transition[\s\S]*to service_role/i);

for (const [label, pattern] of [
  ["valid host session", /service\.rpc\("get_authorized_quiz_room_transition", hostArgs\)/],
  ["valid player session", /service\.rpc\("get_authorized_quiz_room_transition", playerArgs\)/],
  ["invalid session", /p_player_token_hash:\s*hashToken\("invalid-migration-011-session"\)/],
  ["anonymous direct execution", /anonymous\.rpc\("get_authorized_quiz_room_transition", playerArgs\)/],
  ["five concurrent valid player requests", /Array\.from\(\{ length: 5 \}/],
  ["sanitized transition payload", /assertSanitizedTransitionPayload/],
  ["fixture cleanup", /cleanupFixture/]
]) assert.match(verifier, pattern, `Migration 011 verifier is missing: ${label}`);
assert.match(verifier, /42883/, "the staging verifier must identify the exact Migration 010 PostgreSQL regression");

console.log("Migration 011 security unit passed: the hotfix is limited to valid COALESCE syntax, preserves the hardened RPC contract, and includes guarded authorized-session, concurrency, privacy, and cleanup verification.");
