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

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const args = {
  p_room_code: "000000",
  p_question_index: 0,
  p_host_token_hash: null,
  p_player_id: randomUUID(),
  p_player_token_hash: "migration-010-verification"
};

const missingSession = await service.rpc("get_authorized_quiz_room_transition", args);
if (missingSession.error) throw new Error(`authorized transition RPC is unavailable: ${missingSession.error.message}`);
if (missingSession.data?.kind !== "unauthorized") throw new Error("authorized transition RPC disclosed an unexpected missing-room result");

const anonymous = await anon.rpc("get_authorized_quiz_room_transition", args);
if (anonymous.error?.code !== "42501") throw new Error("authorized transition RPC must reject anonymous direct execution");

const routeResponse = await fetch(`${staging.baseUrl}/api/rooms/000000/transition?question=0`, { cache: "no-store" });
if (routeResponse.status !== 403) throw new Error(`transition route returned ${routeResponse.status}; expected session rejection`);
if (routeResponse.headers.get("x-quizloom-transition-coalescer") !== "disabled") throw new Error("transition route did not report its coalescer policy");
if (routeResponse.headers.get("x-quizloom-database-calls") !== "1") throw new Error("transition route did not report its single database call");

console.log("Migration 010 verification passed: staging identity, service-role RPC access, anonymous denial, indistinguishable missing-room authorization, and single-call route diagnostics are correct; no records were written.");
