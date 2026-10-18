import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadStagingEnvironment } from "./lib/staging-environment.mjs";

// Verification coverage: valid player session, valid host session, invalid
// session, anonymous direct execution, five concurrent valid player requests,
// sanitized transition payload, and fixture cleanup.
const staging = loadStagingEnvironment({ argv: process.argv.slice(2), requireWriteConfirmation: true });
const baseUrl = staging.baseUrl;

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${path} returned a non-JSON response (${response.status})`);
  const body = await response.json();
  if (expectedStatus !== undefined ? response.status !== expectedStatus : !response.ok) {
    throw new Error(`${path} returned ${response.status}: ${body.error ?? "request failed"}`);
  }
  return { response, body };
}

function hashToken(token) {
  return createHash("sha256").update(`${process.env.SESSION_TOKEN_PEPPER}:${token}`).digest("hex");
}

function assertSanitizedTransitionPayload(payload) {
  assert.deepEqual(Object.keys(payload).sort(), ["kind", "question", "room"]);
  assert.equal(payload.kind, "ok");
  assert.deepEqual(Object.keys(payload.room).sort(), ["answerCount", "currentQuestion", "questionEndsAt", "questionStartedAt", "status"]);
  assert.deepEqual(Object.keys(payload.question).sort(), ["id", "number", "options", "prompt", "timeLimit"]);
  assert.ok(Array.isArray(payload.question.options));
  assert.equal(payload.question.options.length, 4);
  for (const option of payload.question.options) assert.deepEqual(Object.keys(option).sort(), ["id", "position", "text"]);

  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "is_correct",
    "correctOptionId",
    "correct_option",
    "host_token",
    "player_token",
    "score",
    "streak",
    "correct_answers",
    "response_time"
  ]) assert.ok(!serialized.includes(forbidden), `transition payload exposed forbidden field ${forbidden}`);
}

function assertRpcSuccess(result, label) {
  if (result.error) {
    const exactRegression = result.error.code === "42883" || result.error.message?.includes("pg_catalog.coalesce");
    const prefix = exactRegression ? "Migration 010 PostgreSQL regression 42883 is still present" : `${label} failed`;
    throw new Error(`${prefix}: ${result.error.code ?? "unknown"} ${result.error.message ?? "database request failed"}`);
  }
  assertSanitizedTransitionPayload(result.data);
  return result.data;
}

const identity = await request("/api/benchmark/identity", { cache: "no-store" }, 200);
assert.equal(identity.body.environment, "staging");
assert.equal(identity.body.projectRef, staging.stagingProjectRef);
assert.equal(identity.body.benchmarkWritesEnabled, true);

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, clientOptions);

let quiz;
let room;
let player;

async function cleanupFixture() {
  if (room) {
    await fetch(`${baseUrl}/api/host/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": room.hostToken },
      body: JSON.stringify({ code: room.code, action: "end" })
    }).catch(() => undefined);
  }

  if (quiz) {
    let deleted = false;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(`${baseUrl}/api/quizzes/${quiz.quizId}`, {
        method: "DELETE",
        headers: { "x-quiz-token": quiz.quizToken, Accept: "application/json" }
      });
      lastStatus = response.status;
      if (response.ok || response.status === 404) { deleted = true; break; }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
    assert.ok(deleted, `fixture cleanup could not delete the disposable quiz (last status ${lastStatus})`);
  }

  const cleanupChecks = [];
  if (quiz) {
    cleanupChecks.push(["quiz", service.from("quizzes").select("id", { count: "exact", head: true }).eq("id", quiz.quizId)]);
    cleanupChecks.push(["quiz secret", service.from("quiz_secrets").select("quiz_id", { count: "exact", head: true }).eq("quiz_id", quiz.quizId)]);
    cleanupChecks.push(["question", service.from("questions").select("id", { count: "exact", head: true }).eq("quiz_id", quiz.quizId)]);
  }
  if (room) {
    cleanupChecks.push(["room", service.from("game_rooms").select("id", { count: "exact", head: true }).eq("id", room.roomId)]);
    cleanupChecks.push(["room secret", service.from("room_secrets").select("room_id", { count: "exact", head: true }).eq("room_id", room.roomId)]);
    cleanupChecks.push(["player", service.from("players").select("id", { count: "exact", head: true }).eq("room_id", room.roomId)]);
    cleanupChecks.push(["answer", service.from("answers").select("id", { count: "exact", head: true }).eq("room_id", room.roomId)]);
  }
  if (player) cleanupChecks.push(["player secret", service.from("player_secrets").select("player_id", { count: "exact", head: true }).eq("player_id", player.playerId)]);

  for (const [label, pending] of cleanupChecks) {
    const result = await pending;
    if (result.error) throw new Error(`fixture cleanup ${label} check failed: ${result.error.code ?? "unknown"}`);
    assert.equal(result.count, 0, `fixture cleanup left a ${label} record behind`);
  }
}

let verificationError;
try {
  quiz = (await request("/api/quizzes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      title: `Migration 011 verification ${Date.now()}`,
      description: "Disposable staging RPC verification fixture",
      pointsPerCorrectAnswer: 3,
      questions: [{
        question: "Which option verifies the transition payload?",
        options: ["First", "Second", "Third", "Fourth"],
        correctAnswer: 0,
        timeLimit: 120
      }]
    })
  }, 201)).body;

  room = (await request(`/api/quizzes/${quiz.quizId}`, {
    method: "POST",
    headers: { "x-quiz-token": quiz.quizToken, Accept: "application/json" }
  }, 201)).body;

  player = (await request("/api/players/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code: room.code,
      nickname: "Migration011Player",
      avatar: { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" }
    })
  }, 201)).body;

  await request("/api/host/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-token": room.hostToken },
    body: JSON.stringify({ code: room.code, action: "start" })
  }, 200);

  const hostArgs = {
    p_room_code: room.code,
    p_question_index: 0,
    p_host_token_hash: hashToken(room.hostToken),
    p_player_id: null,
    p_player_token_hash: null
  };
  const playerArgs = {
    p_room_code: room.code,
    p_question_index: 0,
    p_host_token_hash: null,
    p_player_id: player.playerId,
    p_player_token_hash: hashToken(player.playerToken)
  };

  const hostPayload = assertRpcSuccess(await service.rpc("get_authorized_quiz_room_transition", hostArgs), "valid host session");
  const playerPayload = assertRpcSuccess(await service.rpc("get_authorized_quiz_room_transition", playerArgs), "valid player session");
  assert.deepEqual(playerPayload, hostPayload, "host and player sessions must receive the same sanitized transition payload");

  const hostRoute = await request(`/api/rooms/${room.code}/transition?question=0`, {
    cache: "no-store",
    headers: { "x-host-token": room.hostToken }
  }, 200);
  const playerRoute = await request(`/api/rooms/${room.code}/transition?question=0&playerId=${player.playerId}`, {
    cache: "no-store",
    headers: { "x-player-token": player.playerToken }
  }, 200);
  assert.equal(hostRoute.body.question.id, hostPayload.question.id);
  assert.equal(playerRoute.body.question.id, playerPayload.question.id);

  const invalidArgs = { ...playerArgs, p_player_token_hash: hashToken("invalid-migration-011-session") };
  const invalid = await service.rpc("get_authorized_quiz_room_transition", invalidArgs);
  assert.ifError(invalid.error);
  assert.deepEqual(invalid.data, { kind: "unauthorized" });
  await request(`/api/rooms/${room.code}/transition?question=0&playerId=${player.playerId}`, {
    cache: "no-store",
    headers: { "x-player-token": "invalid-migration-011-session" }
  }, 403);

  const anonymousResult = await anonymous.rpc("get_authorized_quiz_room_transition", playerArgs);
  assert.equal(anonymousResult.error?.code, "42501", "anonymous direct execution must remain denied");

  const concurrent = await Promise.all(Array.from({ length: 5 }, () => service.rpc("get_authorized_quiz_room_transition", playerArgs)));
  for (const [index, result] of concurrent.entries()) {
    const payload = assertRpcSuccess(result, `concurrent valid player request ${index + 1}`);
    assert.deepEqual(payload, playerPayload);
  }
} catch (error) {
  verificationError = error;
}

let cleanupError;
try {
  await cleanupFixture();
} catch (error) {
  cleanupError = error;
}

if (verificationError && cleanupError) throw new AggregateError([verificationError, cleanupError], "Migration 011 verification and fixture cleanup both failed");
if (cleanupError) throw cleanupError;
if (verificationError) throw verificationError;

console.log("Migration 011 verification passed: valid host/player sessions, invalid-session rejection, anonymous denial, five concurrent calls, sanitized payloads, route integration, and fixture cleanup are correct.");
