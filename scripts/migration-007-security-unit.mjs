import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/007_backend_performance_optimization.sql", import.meta.url),
  "utf8"
);
const answerRoute = readFileSync(new URL("../app/api/answers/route.ts", import.meta.url), "utf8");

const expectedFunctions = [
  "create_quiz_room",
  "join_quiz_room",
  "submit_quiz_answer_v2",
  "reveal_quiz_answer_with_standings",
  "reveal_quiz_answer"
];

assert.match(migration, /^\s*begin\s*;/i, "migration 007 must begin a transaction");
assert.match(migration, /commit\s*;\s*$/i, "migration 007 must commit its transaction");
assert.doesNotMatch(migration, /\bregistrations\b/i, "migration 007 must not access the unrelated registrations table");
assert.doesNotMatch(migration, /\b(?:truncate|drop\s+table|drop\s+schema)\b/i, "migration 007 must not contain destructive table or schema operations");
assert.doesNotMatch(migration, /create\s+or\s+replace\s+function\s+public\.submit_quiz_answer\s*\(/i, "migration 007 must preserve the legacy answer RPC");
assert.doesNotMatch(migration, /set\s+search_path\s*=\s*public/i, "SECURITY DEFINER functions must not trust the public schema");

const securityDefinerCount = (migration.match(/\bsecurity\s+definer\b/gi) ?? []).length;
assert.equal(securityDefinerCount, expectedFunctions.length, "migration 007 must contain exactly five SECURITY DEFINER functions");

const applicationRelations = [
  "answers",
  "game_rooms",
  "players",
  "player_secrets",
  "questions",
  "question_options",
  "quizzes",
  "quiz_secrets",
  "room_answer_counters",
  "room_secrets"
];
const relationAlternation = applicationRelations.join("|");

for (const functionName of expectedFunctions) {
  const functionPattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\b[\\s\\S]*?\\$\\$\\s*;`,
    "i"
  );
  const match = migration.match(functionPattern);
  assert.ok(match, `missing ${functionName}`);

  const definition = match[0];
  assert.match(
    definition,
    /security\s+definer\s+set\s+search_path\s*=\s*''/i,
    `${functionName} must use an empty search_path`
  );
  assert.doesNotMatch(
    definition,
    new RegExp(`\\b(?:from|join|update|insert\\s+into|delete\\s+from)\\s+(?!public\\.)(?:${relationAlternation})\\b`, "i"),
    `${functionName} contains an unqualified application relation`
  );
  assert.doesNotMatch(
    definition,
    new RegExp(`(?<!public\\.)\\b(?:game_rooms|players)%rowtype\\b`, "i"),
    `${functionName} contains an unqualified application row type`
  );
  assert.doesNotMatch(
    definition,
    /(?<!public\.)\breveal_quiz_answer\s*\(/i,
    `${functionName} contains an unqualified application function call`
  );

  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(
      migration,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\b[\\s\\S]*?from\\s+[^;]*\\b${role}\\b`, "i"),
      `${functionName} must be revoked from ${role}`
    );
  }
  assert.match(
    migration,
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\b[\\s\\S]*?to\\s+service_role`, "i"),
    `${functionName} must be executable only by the service role`
  );
}

for (const builtin of [
  "clock_timestamp",
  "floor",
  "hashtextextended",
  "jsonb_agg",
  "jsonb_build_object",
  "mod",
  "now",
  "pg_advisory_xact_lock",
  "pg_advisory_xact_lock_shared",
  "random"
]) {
  const unqualifiedBuiltin = new RegExp(`(?<!pg_catalog\\.)\\b${builtin}\\s*\\(`, "i");
  assert.doesNotMatch(migration, unqualifiedBuiltin, `${builtin} must be explicitly resolved from pg_catalog`);
}

assert.match(migration, /alter\s+table\s+public\.room_answer_counters\s+enable\s+row\s+level\s+security/i);
assert.match(migration, /revoke\s+all\s+on\s+public\.room_answer_counters\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(migration, /grant\s+select\s+on\s+public\.room_answer_counters\s+to\s+anon/i);
assert.match(migration, /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.room_answer_counters/i);

const counterDefinition = migration.match(/create\s+table\s+if\s+not\s+exists\s+public\.room_answer_counters\s*\([\s\S]*?\n\);/i)?.[0];
assert.ok(counterDefinition, "room_answer_counters definition is missing");
assert.doesNotMatch(
  counterDefinition,
  /\b(?:player_id|selected_option_id|is_correct|points_awarded|response_time_ms)\b/i,
  "Realtime answer counters must contain aggregate activity only"
);

assert.match(migration, /public\.quiz_secrets[\s\S]*?quiz_token_hash\s*=\s*p_quiz_token_hash/i, "room creation must authenticate quiz ownership");
assert.match(migration, /public\.player_secrets[\s\S]*?player_token_hash\s*=\s*p_reconnect_token_hash/i, "reconnect must authenticate the existing player");
assert.match(migration, /public\.player_secrets[\s\S]*?player_token_hash\s*=\s*p_player_token_hash/i, "answer submission must authenticate the player");
assert.match(answerRoute, /const\s+\{\s*error\s*\}\s*=\s*await\s+getAdminClient\(\)\.rpc\("submit_quiz_answer_v2"/i, "the server route must not consume pre-reveal correctness data");
assert.match(answerRoute, /NextResponse\.json\(\{\s*accepted:\s*true\s*\}\)/i, "the pre-reveal response must expose acceptance only");

console.log("Migration 007 security checks passed.");
