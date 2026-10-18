import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/009_countdown_privacy_and_avatar_assignment.sql", "utf8");
const transitionRoute = fs.readFileSync("app/api/rooms/[code]/transition/route.ts", "utf8");
const stateRoute = fs.readFileSync("app/api/rooms/[code]/state/route.ts", "utf8");

assert.match(migration, /^begin;[\s\S]*commit;\s*$/i, "migration 009 must remain transactional");
assert.doesNotMatch(migration, /\bregistrations\b/i, "migration 009 must not access the unrelated registrations table");
assert.equal((migration.match(/security definer/gi) ?? []).length, 2);
assert.equal((migration.match(/set search_path = ''/gi) ?? []).length, 2);
assert.match(migration, /revoke all on function public\.authorize_quiz_room_session[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.authorize_quiz_room_session[\s\S]*to service_role/i);
assert.match(migration, /revoke all on function public\.join_quiz_room[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /:avatar:' \|\| v_character/, "simultaneous duplicate-character joins need a character-scoped lock");
assert.ok(migration.indexOf("'kind', 'reconnected'") < migration.indexOf(":avatar:"), "reconnects must preserve the previously assigned avatar");
assert.match(migration, /where not exists[\s\S]*avatar_config ->> 'accent'/i, "assignment must prefer an unused character/backdrop combination");
assert.match(transitionRoute, /get_authorized_quiz_room_transition/, "the transition route must preserve session-gated hydration through the newer merged RPC");
assert.match(transitionRoute, /x-host-token/);
assert.match(transitionRoute, /x-player-token/);
assert.match(stateRoute, /current && \(hostAuthenticated \|\| playerAuthenticated\)/, "public state must not include question content");

console.log("Migration 009 security unit passed: transactional scope, isolated tables, hardened definers, session-gated question hydration, reconnect preservation, and race-safe avatar assignment.");
