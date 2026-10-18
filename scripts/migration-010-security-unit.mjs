import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/010_authorized_transition_hydration.sql", "utf8");
const transitionRoute = fs.readFileSync("app/api/rooms/[code]/transition/route.ts", "utf8");
const benchmark = fs.readFileSync("scripts/performance-benchmark.mjs", "utf8");
const benchmarkClock = fs.readFileSync("scripts/lib/benchmark-clock.mjs", "utf8");

assert.match(migration, /^begin;[\s\S]*commit;\s*$/i, "migration 010 must remain transactional");
assert.doesNotMatch(migration, /\bregistrations\b/i, "migration 010 must not access the unrelated registrations table");
assert.doesNotMatch(migration, /\b(?:truncate|drop\s+table|delete\s+from|update\s+public\.)\b/i, "migration 010 must remain read-only apart from function permissions");
assert.equal((migration.match(/security definer/gi) ?? []).length, 1);
assert.equal((migration.match(/set search_path = ''/gi) ?? []).length, 1);
assert.match(migration, /create or replace function public\.get_authorized_quiz_room_transition\s*\(/i);
for (const relation of ["public.game_rooms", "public.room_secrets", "public.players", "public.player_secrets", "public.questions", "public.question_options"]) {
  assert.match(migration, new RegExp(relation.replace(".", "\\.")), `migration 010 must qualify ${relation}`);
}
assert.ok(migration.indexOf("if not v_authorized then") < migration.indexOf("from public.questions question"), "question content must not be loaded before authorization succeeds");
assert.doesNotMatch(migration, /\bis_correct\b|correctOptionId|correct_option/i, "transition hydration must not return correctness");
assert.match(migration, /revoke all on function public\.get_authorized_quiz_room_transition[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.get_authorized_quiz_room_transition[\s\S]*to service_role/i);

assert.match(transitionRoute, /get_authorized_quiz_room_transition/);
assert.doesNotMatch(transitionRoute, /authorize_quiz_room_session|get_quiz_room_transition/);
assert.doesNotMatch(transitionRoute, /inFlightTransitions|loadTransition/);
assert.match(transitionRoute, /X-Quizloom-Transition-Coalescer", "disabled"/);
assert.match(transitionRoute, /X-Quizloom-Database-Calls", "1"/);

for (const diagnostic of [
  "clockOffsetUncertainty",
  "headroomClassification",
  "confirmedLate",
  "confirmedReady",
  "requestArrivalApprox",
  "transitionDiagnostics",
  "databaseCalls",
  "transitionProfile"
]) assert.match(benchmark, new RegExp(`\\b${diagnostic}\\b`), `benchmark is missing ${diagnostic}`);
assert.match(benchmarkClock, /headroomMs \+ clock\.uncertaintyMs < 0/);
assert.match(benchmarkClock, /headroomMs - clock\.uncertaintyMs >= 0/);
assert.match(benchmark, /minimumMs:[\s\S]*p05Ms:[\s\S]*p50Ms:[\s\S]*maximumMs:/);

console.log("Migration 010 security unit passed: one hardened authorized hydration RPC, no correctness leakage, service-role-only execution, no process-local correctness dependency, and clock-corrected readiness diagnostics.");
