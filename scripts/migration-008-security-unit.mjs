import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/008_player_presence_privacy.sql", import.meta.url),
  "utf8"
);
const roomHook = readFileSync(new URL("../hooks/use-room.ts", import.meta.url), "utf8");
const benchmark = readFileSync(new URL("./performance-benchmark.mjs", import.meta.url), "utf8");
const stateRoute = readFileSync(new URL("../app/api/rooms/[code]/state/route.ts", import.meta.url), "utf8");

assert.match(migration, /^\s*begin\s*;/i, "migration 008 must begin a transaction");
assert.match(migration, /commit\s*;\s*$/i, "migration 008 must commit its transaction");
assert.match(migration, /if\s+pg_catalog\.has_schema_privilege\('anon',\s*'public',\s*'CREATE'\)[\s\S]*?pg_catalog\.has_schema_privilege\('authenticated',\s*'public',\s*'CREATE'\)[\s\S]*?raise\s+exception/i, "migration 008 must fail closed when untrusted roles can create public-schema objects");
assert.doesNotMatch(migration, /\bregistrations\b/i, "migration 008 must not access the unrelated registrations table");
assert.doesNotMatch(migration, /(?:^|\n)\s*(?:truncate|drop\s+schema|drop\s+table)\b/im, "migration 008 must not destroy application tables or schemas");

const projection = migration.match(/create\s+table\s+public\.room_player_presence\s*\([\s\S]*?\n\);/i)?.[0];
assert.ok(projection, "the safe player-presence projection is missing");
for (const safeColumn of ["id", "room_id", "nickname", "avatar_config", "joined_at"]) {
  assert.match(projection, new RegExp(`\\b${safeColumn}\\b`, "i"), `projection is missing ${safeColumn}`);
}
assert.doesNotMatch(
  projection,
  /\b(?:score|streak|correct_answers|correct_response_time_ms|player_token_hash)\b/i,
  "the anonymous projection must not contain scoring, ranking, or token data"
);

assert.match(migration, /alter\s+table\s+public\.room_player_presence\s+enable\s+row\s+level\s+security/i);
assert.match(migration, /create\s+policy\s+"player presence is visible for realtime"[\s\S]*?room\.expires_at\s*>\s*pg_catalog\.now\(\)/i);
assert.match(migration, /grant\s+select\s+on\s+public\.room_player_presence\s+to\s+anon/i);
assert.match(migration, /drop\s+policy\s+if\s+exists\s+"players are visible for realtime"\s+on\s+public\.players/i);
assert.match(migration, /revoke\s+select\s+on\s+public\.players\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(migration, /revoke\s+select\s*\([\s\S]*?correct_response_time_ms[\s\S]*?\)\s+on\s+public\.players\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.doesNotMatch(migration, /grant\s+select\s+on\s+public\.players\s+to\s+anon/i);
assert.match(migration, /alter\s+publication\s+supabase_realtime\s+drop\s+table\s+public\.players/i);
assert.match(migration, /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.room_player_presence/i);

const triggerFunction = migration.match(/create\s+or\s+replace\s+function\s+public\.sync_room_player_presence\(\)[\s\S]*?\$\$\s*;/i)?.[0];
assert.ok(triggerFunction, "the projection sync trigger function is missing");
assert.match(triggerFunction, /security\s+definer\s+set\s+search_path\s*=\s*''/i);
assert.match(triggerFunction, /insert\s+into\s+public\.room_player_presence/i);
assert.doesNotMatch(triggerFunction, /(?<!public\.)\broom_player_presence\b/i, "application relations must be schema-qualified");
assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.sync_room_player_presence\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);

const statusFunction = migration.match(/create\s+or\s+replace\s+function\s+public\.get_quizloom_privacy_status\(\)[\s\S]*?\$\$\s*;/i)?.[0];
assert.ok(statusFunction, "the service-only privacy/publication verifier is missing");
assert.match(statusFunction, /security\s+invoker\s+set\s+search_path\s*=\s*''/i);
assert.doesNotMatch(statusFunction, /security\s+definer/i, "the catalog verifier must not elevate its caller");
for (const check of [
  "pg_catalog.pg_publication_tables",
  "pg_catalog.has_table_privilege",
  "pg_catalog.has_column_privilege",
  "pg_catalog.has_function_privilege",
  "pg_catalog.has_schema_privilege"
]) {
  assert.match(statusFunction, new RegExp(check.replace(".", "\\."), "i"), `privacy status is missing ${check}`);
}
assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.get_quizloom_privacy_status\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.get_quizloom_privacy_status\(\)\s+to\s+service_role/i);

for (const source of [roomHook, benchmark]) {
  assert.match(source, /table:\s*"room_player_presence"/i, "Realtime consumers must use the safe projection");
  assert.doesNotMatch(source, /table:\s*"players"/i, "Realtime consumers must not subscribe to sensitive player rows");
}

assert.match(stateRoute, /db\.from\("players"\)/, "the trusted state route must retain authoritative player access");
assert.match(stateRoute, /const\s+standingsVisible\s*=\s*publicStatus\s*===\s*"finished"\s*\|\|\s*hostAuthenticated/i, "ranking fields must remain masked before finish");
assert.match(stateRoute, /standingsVisible\s*\?\s*view\s*:\s*\{[\s\S]*?score:\s*0,[\s\S]*?correctAnswers:\s*0,[\s\S]*?streak:\s*0,[\s\S]*?correctResponseTimeMs:\s*null/i, "opponent ranking fields must be zeroed before finish");
assert.match(benchmark, /table:\s*"room_player_presence"/i);

const verifier = readFileSync(new URL("./verify-migration-008.mjs", import.meta.url), "utf8");
assert.match(verifier, /service\.rpc\("get_quizloom_privacy_status"\)/i, "the staging verifier must inspect actual publication and privilege state");
assert.match(verifier, /players_published:\s*false/i);
assert.match(verifier, /room_player_presence_published:\s*true/i);
assert.match(verifier, /for\s*\(const\s+column\s+of\s+\["score",\s*"streak",\s*"correct_answers",\s*"correct_response_time_ms"\]\)/i, "each sensitive column must be checked independently");

console.log("Migration 008 privacy checks passed.");
