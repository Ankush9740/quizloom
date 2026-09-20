import assert from "node:assert/strict";

const baseUrl = process.env.QUIZLOOM_TEST_URL ?? "http://127.0.0.1:3000";
const avatar = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  assert.ok(contentType.includes("application/json"), `${path} did not return JSON`);
  const body = await response.json();
  if (expectedStatus === undefined) assert.ok(response.ok, `${path} returned ${response.status}: ${body.error ?? "request failed"}`);
  else assert.equal(response.status, expectedStatus, `${path}: ${body.error ?? "unexpected status"}`);
  return body;
}

function standings(players) {
  return Object.fromEntries(players.map(player => [player.nickname, player.score]));
}
const waitForQuestionStart = state => new Promise(resolve => setTimeout(resolve, Math.max(0, new Date(state.room.questionStartedAt).getTime() - Date.now()) + 100));

let quiz;
let room;
try {
  quiz = await request("/api/quizzes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      title: `Host leaderboard regression ${Date.now()}`,
      description: "Disposable authoritative-score regression",
      pointsPerCorrectAnswer: 7,
      questions: [1, 2].map(number => ({
        question: `Regression question ${number}?`,
        options: ["Correct", "Incorrect", "Other", "Another"],
        correctAnswer: 0,
        timeLimit: 120
      }))
    })
  }, 201);
  room = await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: { "x-quiz-token": quiz.quizToken } }, 201);

  const [ada, ben, cy] = await Promise.all(["Ada", "Ben", "Cy"].map(nickname => request("/api/players/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: room.code, nickname, avatar })
  }, 201)));
  const hostAction = action => request("/api/host/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-token": room.hostToken },
    body: JSON.stringify({ code: room.code, action })
  });
  const playerState = player => request(`/api/rooms/${room.code}/state?playerId=${player.playerId}`, { headers: { "x-player-token": player.playerToken } });
  const answer = (player, optionId) => request("/api/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-player-token": player.playerToken },
    body: JSON.stringify({ code: room.code, playerId: player.playerId, optionId })
  });
  const hostState = () => request(`/api/rooms/${room.code}/state`, { headers: { "x-host-token": room.hostToken } });

  await hostAction("start");
  let state = await playerState(ada);
  await waitForQuestionStart(state);
  await Promise.all([answer(ada, state.question.options[0].id), answer(ben, state.question.options[1].id)]);
  let reveal = await hostAction("reveal");
  assert.deepEqual(standings(reveal.players), { Ada: 7, Ben: 0, Cy: 0 }, "Reveal response must contain correct, incorrect, and unanswered totals");
  assert.deepEqual(standings((await hostState()).players), { Ada: 7, Ben: 0, Cy: 0 }, "A host refresh must agree with reveal standings");

  await request("/api/host/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-token": room.hostToken },
    body: JSON.stringify({ code: room.code, action: "reveal" })
  }, 409);
  assert.deepEqual(standings((await hostState()).players), { Ada: 7, Ben: 0, Cy: 0 }, "A duplicate reveal must not award points twice");

  await hostAction("next");
  state = await playerState(ada);
  await waitForQuestionStart(state);
  await Promise.all([answer(ada, state.question.options[1].id), answer(ben, state.question.options[0].id)]);
  reveal = await hostAction("reveal");
  assert.deepEqual(standings(reveal.players), { Ada: 7, Ben: 7, Cy: 0 }, "Scores must accumulate authoritatively across questions");
  assert.deepEqual(standings((await hostState()).players), { Ada: 7, Ben: 7, Cy: 0 }, "Reconnect/refresh standings must remain consistent");

  await hostAction("next");
  assert.deepEqual(standings((await hostState()).players), { Ada: 7, Ben: 7, Cy: 0 }, "Final podium data must match the reveal leaderboard");
  console.log("Host leaderboard regression passed: three-player reveal, 7-point scoring, duplicate reveal, refresh, next question, and final standings agree.");
} finally {
  if (room) {
    try {
      await request("/api/host/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-host-token": room.hostToken },
        body: JSON.stringify({ code: room.code, action: "end" })
      });
    } catch {}
  }
  if (quiz) {
    try { await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: { "x-quiz-token": quiz.quizToken } }); } catch {}
  }
}
