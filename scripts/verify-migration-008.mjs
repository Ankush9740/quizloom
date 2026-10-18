import { createClient } from "@supabase/supabase-js";
import { loadStagingEnvironment } from "./lib/staging-environment.mjs";

const staging = loadStagingEnvironment({ argv: process.argv.slice(2), requireWriteConfirmation: true });
const identityResponse = await fetch(`${staging.baseUrl}/api/benchmark/identity`, { cache: "no-store" });
if (!identityResponse.ok) throw new Error(`Staging identity endpoint returned ${identityResponse.status}`);
const identity = await identityResponse.json();
if (identity.environment !== "staging" || identity.projectRef !== staging.stagingProjectRef || !identity.benchmarkWritesEnabled) {
  throw new Error("The running application and migration verifier are not targeting the same write-enabled staging project");
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);

const projection = await service.from("room_player_presence").select("id,room_id,nickname,avatar_config,joined_at").limit(1);
if (projection.error) throw new Error(`room_player_presence is unavailable: ${projection.error.message}`);

const trustedPlayers = await service.from("players").select("id,score,streak,correct_answers,correct_response_time_ms").limit(1);
if (trustedPlayers.error) throw new Error(`trusted player access is unavailable: ${trustedPlayers.error.message}`);

const anonymousProjection = await anon.from("room_player_presence").select("id,room_id,nickname,avatar_config,joined_at").limit(1);
if (anonymousProjection.error) throw new Error(`anonymous presence projection is unavailable: ${anonymousProjection.error.message}`);

const unexpectedProjectionColumns = await service.from("room_player_presence").select("score,streak,correct_answers,correct_response_time_ms").limit(1);
if (!unexpectedProjectionColumns.error) throw new Error("The anonymous projection contains sensitive player columns");

for (const column of ["score", "streak", "correct_answers", "correct_response_time_ms"]) {
  const result = await anon.from("players").select(column).limit(1);
  if (result.error?.code !== "42501") throw new Error(`Anonymous browsers can still select players.${column}`);
}

for (const [table, columns] of [
  ["player_secrets", "player_token_hash"],
  ["answers", "selected_option_id,is_correct,points_awarded,response_time_ms"]
]) {
  const result = await anon.from(table).select(columns).limit(1);
  if (result.error?.code !== "42501") throw new Error(`Anonymous browsers can still select sensitive ${table} data`);
}

const embeddedPlayers = await anon.from("room_player_presence")
  .select("id,players!room_player_presence_id_fkey(score,streak,correct_answers,correct_response_time_ms)")
  .limit(1);
if (!embeddedPlayers.error) throw new Error("Anonymous browsers can embed sensitive player rows through the presence projection");

for (const [name, args] of [
  ["reveal_quiz_answer_with_standings", { p_room_id: "00000000-0000-0000-0000-000000000000" }],
  ["get_player_reveal", { p_room_code: "000000", p_player_id: "00000000-0000-0000-0000-000000000000", p_player_token_hash: "verification" }],
  ["get_quizloom_privacy_status", {}]
]) {
  const result = await anon.rpc(name, args);
  if (result.error?.code !== "42501") throw new Error(`${name} must reject anonymous execution`);
}

const { data: statusRows, error: statusError } = await service.rpc("get_quizloom_privacy_status");
if (statusError) throw new Error(`privacy/publication status is unavailable: ${statusError.message}`);
const status = Array.isArray(statusRows) ? statusRows[0] : statusRows;
const expectedStatus = {
  projection_rls_enabled: true,
  projection_anon_select_policy: true,
  players_anon_select_policy: false,
  players_published: false,
  room_player_presence_published: true,
  anon_projection_select: true,
  anon_players_select: false,
  anon_score_select: false,
  anon_streak_select: false,
  anon_correct_answers_select: false,
  anon_response_time_select: false,
  anon_player_secrets_select: false,
  anon_answers_select: false,
  anon_reveal_standings_execute: false,
  anon_player_reveal_execute: false,
  anon_public_schema_create: false,
  authenticated_public_schema_create: false
};
for (const [key, expected] of Object.entries(expectedStatus)) {
  if (status?.[key] !== expected) throw new Error(`Migration 008 privacy status is incorrect for ${key}`);
}

console.log("Migration 008 verification passed: RLS, effective anonymous privileges, sensitive relations/RPCs, and Realtime publication are correct; no records were written.");
