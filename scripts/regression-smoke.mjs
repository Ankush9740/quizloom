const baseUrl = process.env.QUIZLOOM_TEST_URL ?? "http://localhost:3000";

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${path} returned ${contentType || "no content type"}`);
  const body = await response.json();
  if (expectedStatus !== undefined) {
    if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}`);
  } else if (!response.ok) throw new Error(`${path} failed: ${body.error ?? response.status}`);
  return { body, status: response.status };
}

const avatarOne = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
const avatarTwo = { base: "bot", skin: "#9EB4FF", eyes: "wink", head: "crown", accessory: "stars", accent: "#D83A78" };
const quizDocument = {
  version: 1,
  title: `Regression ${Date.now()}`,
  description: "Disposable end-to-end verification quiz",
  pointsPerCorrectAnswer: 5,
  questions: [
    { question: "Which option is correct for test one?", options: ["Correct", "Wrong", "Also wrong", "Still wrong"], correctAnswer: 0, timeLimit: 60 },
    { question: "Which option is correct for test two?", options: ["Correct", "Wrong", "Also wrong", "Still wrong"], correctAnswer: 0, timeLimit: 60 }
  ]
};

let quiz;
let room;
try {
  quiz = (await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(quizDocument) }, 201)).body;
  const quizHeaders = { "x-quiz-token": quiz.quizToken, "Accept": "application/json" };

  const library = (await request("/api/quizzes/library", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ access: [{ id: quiz.quizId, token: quiz.quizToken }] }) }, 200)).body;
  if (!library.quizzes.some(item => item.id === quiz.quizId)) throw new Error("Created quiz was missing from library");

  const exported = (await request(`/api/quizzes/${quiz.quizId}`, { headers: quizHeaders }, 200)).body;
  if (exported.pointsPerCorrectAnswer !== 5) throw new Error("Configured points were not exported");
  exported.description = "Edited by regression verification";
  await request(`/api/quizzes/${quiz.quizId}`, { method: "PUT", headers: { ...quizHeaders, "Content-Type": "application/json" }, body: JSON.stringify(exported) }, 200);

  room = (await request(`/api/quizzes/${quiz.quizId}/rooms`, { method: "POST", headers: quizHeaders }, 201)).body;
  await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: quizHeaders }, 409);

  const playerOne = (await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ code: room.code, nickname: "CorrectTester", avatar: avatarOne }) }, 201)).body;
  const playerTwo = (await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ code: room.code, nickname: "WrongTester", avatar: avatarTwo }) }, 201)).body;
  const hostHeaders = { "Content-Type": "application/json", "Accept": "application/json", "x-host-token": room.hostToken };
  const playerHeaders = player => ({ "Content-Type": "application/json", "Accept": "application/json", "x-player-token": player.playerToken });
  const hostAction = action => request("/api/host/action", { method: "POST", headers: hostHeaders, body: JSON.stringify({ code: room.code, action }) }, 200);
  const stateFor = player => request(`/api/rooms/${room.code}/state?playerId=${player.playerId}`, { headers: { "Accept": "application/json", "x-player-token": player.playerToken } }, 200).then(result => result.body);
  const submit = (player, optionId, expectedStatus = 200) => request("/api/answers", { method: "POST", headers: playerHeaders(player), body: JSON.stringify({ code: room.code, playerId: player.playerId, optionId }) }, expectedStatus);

  await hostAction("start");
  let state = await stateFor(playerOne);
  if (state.room.answerCount !== 0) throw new Error("Answer counter did not start at zero");
  const savedAvatars = new Map(state.players.map(player => [player.nickname, player.avatar]));
  if (savedAvatars.get("CorrectTester")?.base !== avatarOne.base || savedAvatars.get("WrongTester")?.base !== avatarTwo.base) throw new Error("Player avatar configuration did not persist");
  await submit(playerOne, state.question.options[0].id);
  await submit(playerTwo, state.question.options[1].id);
  await submit(playerOne, state.question.options[0].id, 400);
  state = await stateFor(playerOne);
  if (state.room.answerCount !== 2) throw new Error("Answer counter did not reach 2");
  if (state.players.some(player => player.score !== 0)) throw new Error("A score changed before reveal");

  await hostAction("reveal");
  const correctReveal = await stateFor(playerOne);
  const wrongReveal = await stateFor(playerTwo);
  if (!correctReveal.me.wasCorrect || correctReveal.me.lastPoints !== 5 || correctReveal.me.score !== 5) throw new Error("Correct fixed-point scoring failed");
  if (wrongReveal.me.wasCorrect !== false || wrongReveal.me.lastPoints !== 0 || wrongReveal.me.score !== 0) throw new Error("Wrong-answer scoring failed");

  await hostAction("next");
  state = await stateFor(playerOne);
  await submit(playerOne, state.question.options[0].id);
  state = await stateFor(playerOne);
  if (state.room.answerCount !== 1) throw new Error("Second-question answer counter failed");
  await hostAction("reveal");
  const secondCorrect = await stateFor(playerOne);
  const unanswered = await stateFor(playerTwo);
  if (secondCorrect.me.score !== 10 || secondCorrect.me.lastPoints !== 5) throw new Error("Leaderboard total did not use fixed points");
  if (unanswered.me.answered || unanswered.me.lastPoints !== 0 || unanswered.me.score !== 0) throw new Error("Unanswered scoring failed");
  await hostAction("next");
  const finished = await stateFor(playerOne);
  if (finished.room.status !== "finished") throw new Error("Quiz did not reach final results");

  await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: quizHeaders }, 200);
  quiz = undefined;

  const legacyDocument = { ...quizDocument, title: `Legacy ${Date.now()}` };
  delete legacyDocument.pointsPerCorrectAnswer;
  const legacy = (await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(legacyDocument) }, 201)).body;
  const legacyHeaders = { "x-quiz-token": legacy.quizToken, "Accept": "application/json" };
  const legacyExport = (await request(`/api/quizzes/${legacy.quizId}`, { headers: legacyHeaders }, 200)).body;
  if (legacyExport.pointsPerCorrectAnswer !== 1) throw new Error("Legacy JSON default failed");
  await request(`/api/quizzes/${legacy.quizId}`, { method: "DELETE", headers: legacyHeaders }, 200);

  console.log("Regression smoke test passed: library, create, edit, host, join, duplicate protection, fixed scoring, answer counter, reveal feedback data, final results, legacy JSON, and deletion.");
} finally {
  if (quiz) {
    try {
      if (room) await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "x-host-token": room.hostToken }, body: JSON.stringify({ code: room.code, action: "end" }) });
      await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: { "x-quiz-token": quiz.quizToken, "Accept": "application/json" } });
    } catch { /* Preserve the original test failure. */ }
  }
}
