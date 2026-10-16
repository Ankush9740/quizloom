import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadStagingEnvironment } from "./lib/staging-environment.mjs";

const staging = loadStagingEnvironment({ argv: process.argv.slice(2), requireWriteConfirmation: true });
const identityResponse = await fetch(`${staging.baseUrl}/api/benchmark/identity`, { cache: "no-store" });
if (!identityResponse.ok) throw new Error(`Staging identity endpoint returned ${identityResponse.status}`);
const identity = await identityResponse.json();
if (identity.environment !== "staging" || identity.projectRef !== staging.stagingProjectRef || !identity.benchmarkWritesEnabled) {
  throw new Error("The running application and migration verifier are not targeting the same write-enabled staging project");
}

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const counters = await service.from("room_answer_counters").select("room_id,question_index,bucket,answer_count,updated_at").limit(1);
if (counters.error) throw new Error(`room_answer_counters is unavailable: ${counters.error.message}`);

const missingQuiz = await service.rpc("create_quiz_room", {
  p_quiz_id: randomUUID(), p_quiz_token_hash: "verification", p_host_token_hash: "verification"
});
if (missingQuiz.error || missingQuiz.data?.kind !== "forbidden") throw new Error("create_quiz_room verification failed");

const missingJoin = await service.rpc("join_quiz_room", {
  p_room_code: "migration-007-verification-missing", p_nickname: "Verifier", p_avatar: {},
  p_existing_player_id: null, p_reconnect_token_hash: null, p_new_player_token_hash: "verification"
});
if (missingJoin.error || missingJoin.data?.kind !== "missing") throw new Error("join_quiz_room verification failed");

for (const [name, args, expectedMessage] of [
  ["submit_quiz_answer_v2", { p_room_code: "migration-007-verification-missing", p_player_id: randomUUID(), p_player_token_hash: "verification", p_option_id: randomUUID() }, "no longer accepting"],
  ["reveal_quiz_answer_with_standings", { p_room_id: randomUUID() }, "no active question"]
]) {
  const result = await service.rpc(name, args);
  if (!result.error?.message.toLowerCase().includes(expectedMessage)) throw new Error(`${name} verification failed`);
}

for (const [name, args] of [
  ["create_quiz_room", { p_quiz_id: randomUUID(), p_quiz_token_hash: "verification", p_host_token_hash: "verification" }],
  ["join_quiz_room", { p_room_code: "migration-007-verification-missing", p_nickname: "Verifier", p_avatar: {}, p_existing_player_id: null, p_reconnect_token_hash: null, p_new_player_token_hash: "verification" }],
  ["submit_quiz_answer_v2", { p_room_code: "migration-007-verification-missing", p_player_id: randomUUID(), p_player_token_hash: "verification", p_option_id: randomUUID() }],
  ["reveal_quiz_answer_with_standings", { p_room_id: randomUUID() }]
]) {
  const result = await anon.rpc(name, args);
  if (result.error?.code !== "42501") throw new Error(`${name} must reject anonymous execution`);
}

console.log("Migration 007 verification passed: schema and RPCs are available only to the service role, and the running app targets the same staging project.");
