import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.QUIZLOOM_TEST_URL ?? "http://127.0.0.1:3000";
const avatar = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${path} returned ${contentType || "no content type"}`);
  const body = await response.json();
  if (expectedStatus !== undefined ? response.status !== expectedStatus : !response.ok) throw new Error(`${path} returned ${response.status}: ${body.error ?? "request failed"}`);
  return body;
}

const quizDocument = {
  version: 1,
  title: `Multiplayer improvements ${Date.now()}`,
  description: "Disposable speed-ranking and timer regression",
  pointsPerCorrectAnswer: 5,
  questions: [5, 15, 45, 75, 120, 300].map((timeLimit, index) => ({
    question: `Custom timer question ${index + 1}?`,
    options: ["Correct", "Wrong one", "Wrong two", "Wrong three"],
    correctAnswer: 0,
    timeLimit
  }))
};

let quiz;
let room;
let legacyRoom;
let longRoom;
try {
  quiz = await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quizDocument) }, 201);
  const quizHeaders = { "x-quiz-token": quiz.quizToken };
  const exported = await request(`/api/quizzes/${quiz.quizId}`, { headers: quizHeaders }, 200);
  if (exported.questions.map(question => question.timeLimit).join(",") !== "5,15,45,75,120,300") throw new Error("Custom timers did not survive save/export");
  await request(`/api/quizzes/${quiz.quizId}`, { method: "PUT", headers: { ...quizHeaders, "Content-Type": "application/json" }, body: JSON.stringify(exported) }, 200);
  const edited = await request(`/api/quizzes/${quiz.quizId}`, { headers: quizHeaders }, 200);
  if (edited.questions.map(question => question.timeLimit).join(",") !== "5,15,45,75,120,300") throw new Error("Custom timers did not survive edit/reload");

  for (const invalid of [0, -1, 5.5, 301, null]) {
    const invalidDocument = { ...quizDocument, title: `Invalid ${String(invalid)} ${Date.now()}`, questions: [{ ...quizDocument.questions[0], timeLimit: invalid }] };
    await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invalidDocument) }, 400);
  }

  room = await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: quizHeaders }, 201);
  const players = await Promise.all(["Fast", "Slow", "Wrong"].map(nickname => request("/api/players/join", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: room.code, nickname, avatar })
  }, 201)));
  const hostAction = action => request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": room.hostToken }, body: JSON.stringify({ code: room.code, action }) }, 200);
  const stateFor = player => request(`/api/rooms/${room.code}/state?playerId=${player.playerId}`, { headers: { "x-player-token": player.playerToken } }, 200);
  const submit = (player, optionId, expected = 200) => request("/api/answers", { method: "POST", headers: { "Content-Type": "application/json", "x-player-token": player.playerToken }, body: JSON.stringify({ code: room.code, playerId: player.playerId, optionId }) }, expected);

  const reconnected = await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json", "x-player-token": players[0].playerToken }, body: JSON.stringify({ code: room.code, nickname: players[0].nickname, avatar, playerId: players[0].playerId }) }, 200);
  if (!reconnected.reconnected || reconnected.playerId !== players[0].playerId) throw new Error("Reconnect did not preserve the original participant");

  const transition = (await hostAction("start")).transition;
  const durationMs = new Date(transition.room.questionEndsAt).getTime() - new Date(transition.room.questionStartedAt).getTime();
  if (durationMs !== 5_000) throw new Error(`Expected a 5-second authoritative duration, received ${durationMs}ms`);
  if (new Date(transition.room.questionStartedAt).getTime() - Date.now() < 1_500) throw new Error("Question start was not scheduled far enough ahead for delivery");
  await submit(players[0], transition.question.options[0].id, 400);
  await sleep(Math.max(0, new Date(transition.room.questionStartedAt).getTime() - Date.now()) + 100);
  await submit(players[0], transition.question.options[0].id);
  await sleep(350);
  await submit(players[1], transition.question.options[0].id);
  await submit(players[2], transition.question.options[1].id);
  await submit(players[0], transition.question.options[0].id, 400);
  await hostAction("reveal");

  const hostState = await request(`/api/rooms/${room.code}/state`, { headers: { "x-host-token": room.hostToken } }, 200);
  if (hostState.players.map(player => player.nickname).join(",") !== "Fast,Slow,Wrong") throw new Error("Authoritative speed ordering was not reflected in the host leaderboard");
  if (!(hostState.players[0].correctResponseTimeMs < hostState.players[1].correctResponseTimeMs)) throw new Error("Correct-answer response time was not captured authoritatively");
  const refreshedHostState = await request(`/api/rooms/${room.code}/state`, { headers: { "x-host-token": room.hostToken } }, 200);
  if (refreshedHostState.players.map(player => player.nickname).join(",") !== "Fast,Slow,Wrong") throw new Error("Speed ordering did not persist across authoritative refresh");

  const publicResults = await stateFor(players[0]);
  if (publicResults.players.some(player => player.score !== 0 || player.correctResponseTimeMs !== null)) throw new Error("Player-facing rankings leaked before final results");
  await hostAction("end");

  legacyRoom = await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: quizHeaders }, 201);
  const legacyMode = await db.from("game_rooms").update({ speed_ranking_enabled: false }).eq("id", legacyRoom.roomId);
  if (legacyMode.error) throw new Error(`Could not prepare legacy compatibility fixture: ${legacyMode.error.message}`);
  const legacyPlayers = await Promise.all(["ZuluFast", "AlphaSlow"].map(nickname => request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: legacyRoom.code, nickname, avatar }) }, 201)));
  const legacyAction = action => request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": legacyRoom.hostToken }, body: JSON.stringify({ code: legacyRoom.code, action }) }, 200);
  const legacyTransition = (await legacyAction("start")).transition;
  await sleep(Math.max(0, new Date(legacyTransition.room.questionStartedAt).getTime() - Date.now()) + 100);
  await request("/api/answers", { method: "POST", headers: { "Content-Type": "application/json", "x-player-token": legacyPlayers[0].playerToken }, body: JSON.stringify({ code: legacyRoom.code, playerId: legacyPlayers[0].playerId, optionId: legacyTransition.question.options[0].id }) }, 200);
  await sleep(300);
  await request("/api/answers", { method: "POST", headers: { "Content-Type": "application/json", "x-player-token": legacyPlayers[1].playerToken }, body: JSON.stringify({ code: legacyRoom.code, playerId: legacyPlayers[1].playerId, optionId: legacyTransition.question.options[0].id }) }, 200);
  await legacyAction("reveal");
  const legacyState = await request(`/api/rooms/${legacyRoom.code}/state`, { headers: { "x-host-token": legacyRoom.hostToken } }, 200);
  if (legacyState.players.some(player => player.speedRankingEnabled)) throw new Error("Legacy room unexpectedly opted into speed ranking");
  if (legacyState.players.map(player => player.nickname).join(",") !== "AlphaSlow,ZuluFast") throw new Error("Legacy room did not retain deterministic legacy ordering");
  await legacyAction("end");

  const longQuiz = { ...exported, questions: [{ ...exported.questions.at(-1), question: "Does the 300 second timer host correctly?" }] };
  await request(`/api/quizzes/${quiz.quizId}`, { method: "PUT", headers: { ...quizHeaders, "Content-Type": "application/json" }, body: JSON.stringify(longQuiz) }, 200);
  longRoom = await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: quizHeaders }, 201);
  const longPlayer = await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: longRoom.code, nickname: "LongTimer", avatar }) }, 201);
  const longTransition = await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": longRoom.hostToken }, body: JSON.stringify({ code: longRoom.code, action: "start" }) }, 200);
  if (new Date(longTransition.transition.room.questionEndsAt).getTime() - new Date(longTransition.transition.room.questionStartedAt).getTime() !== 300_000) throw new Error("Hosted 300-second timer did not produce a 300-second authoritative deadline");
  const longState = await request(`/api/rooms/${longRoom.code}/state?playerId=${longPlayer.playerId}`, { headers: { "x-player-token": longPlayer.playerToken } }, 200);
  if (longState.question.timeLimit !== 300) throw new Error("Player state did not preserve the hosted 300-second timer");
  await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": longRoom.hostToken }, body: JSON.stringify({ code: longRoom.code, action: "end" }) }, 200);

  await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: quizHeaders }, 200);
  quiz = undefined;
  console.log("Multiplayer improvements integration regression passed: custom timer create/edit/export, 5s and 300s hosting, scheduled start, pre-start rejection, server-timestamp speed ranking, reconnect/refresh persistence, legacy-room compatibility, duplicate submission protection, hidden in-quiz rankings, and cleanup.");
} finally {
  for (const activeRoom of [longRoom, legacyRoom, room]) {
    if (!activeRoom) continue;
    try { await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": activeRoom.hostToken }, body: JSON.stringify({ code: activeRoom.code, action: "end" }) }); } catch {}
  }
  if (quiz) {
    try { await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: { "x-quiz-token": quiz.quizToken } }); } catch {}
  }
}
