const baseUrl = process.env.QUIZLOOM_TEST_URL ?? "http://localhost:3000";

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${path} returned ${contentType || "no content type"}`);
  const body = await response.json();
  if (expectedStatus !== undefined) {
    if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${body.error ?? JSON.stringify(body)}`);
  } else if (!response.ok) throw new Error(`${path} failed: ${body.error ?? response.status}`);
  return { body, status: response.status };
}

async function sampledState(path, headers, wallClockSkewMs = 0) {
  const clientSentWallMs = Date.now() + wallClockSkewMs;
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store", headers });
  const body = await response.json();
  const clientReceivedWallMs = Date.now() + wallClockSkewMs;
  const monotonicTimeMs = performance.now();
  if (!response.ok) throw new Error(`${path} failed while sampling its server clock`);
  const serverReceivedMs = new Date(body.clock.receivedAt).getTime();
  const serverSentMs = new Date(body.clock.sentAt).getTime();
  const offsetMs = ((serverReceivedMs - clientSentWallMs) + (serverSentMs - clientReceivedWallMs)) / 2;
  return { body, serverTimeMs: clientReceivedWallMs + offsetMs, monotonicTimeMs };
}

const avatarOne = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
const avatarTwo = { base: "bot", skin: "#9EB4FF", eyes: "dot", head: "none", accessory: "none", accent: "#14213D", character: "robot" };
const waitForQuestionStart = state => new Promise(resolve => setTimeout(resolve, Math.max(0, new Date(state.room.questionStartedAt).getTime() - Date.now()) + 100));
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
let latestRoom;
let deadlineRoom;
const timings = {};
try {
  quiz = (await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(quizDocument) }, 201)).body;
  const quizHeaders = { "x-quiz-token": quiz.quizToken, "Accept": "application/json" };

  const library = (await request("/api/quizzes/library", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ access: [{ id: quiz.quizId, token: quiz.quizToken }] }) }, 200)).body;
  if (!library.quizzes.some(item => item.id === quiz.quizId)) throw new Error("Created quiz was missing from library");

  const exported = (await request(`/api/quizzes/${quiz.quizId}`, { headers: quizHeaders }, 200)).body;
  if (exported.pointsPerCorrectAnswer !== 5) throw new Error("Configured points were not exported");
  exported.description = "Edited by regression verification";
  await request(`/api/quizzes/${quiz.quizId}`, { method: "PUT", headers: { ...quizHeaders, "Content-Type": "application/json" }, body: JSON.stringify(exported) }, 200);

  room = (await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: quizHeaders }, 201)).body;
  await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: quizHeaders }, 409);

  const joinedPlayers = await Promise.all(Array.from({ length: 20 }, async (_, index) => (await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ code: room.code, nickname: index === 0 ? "CorrectTester" : index === 1 ? "WrongTester" : `LoadTester${index + 1}`, avatar: index % 2 ? avatarTwo : avatarOne }) }, 201)).body));
  const [playerOne, playerTwo] = joinedPlayers;
  const playerHeaders = player => ({ "Content-Type": "application/json", "Accept": "application/json", "x-player-token": player.playerToken });
  const hostAction = (targetRoom, action) => request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "x-host-token": targetRoom.hostToken }, body: JSON.stringify({ code: targetRoom.code, action }) }, 200).then(result => result.body);
  const stateFor = (targetRoom, player) => request(`/api/rooms/${targetRoom.code}/state?playerId=${player.playerId}`, { headers: { "Accept": "application/json", "x-player-token": player.playerToken } }, 200).then(result => result.body);
  const hostState = targetRoom => request(`/api/rooms/${targetRoom.code}/state`, { headers: { "Accept": "application/json", "x-host-token": targetRoom.hostToken } }, 200).then(result => result.body);
  const publicState = targetRoom => request(`/api/rooms/${targetRoom.code}/state`, { headers: { "Accept": "application/json" } }, 200).then(result => result.body);
  const submit = (targetRoom, player, optionId, expectedStatus = 200) => request("/api/answers", { method: "POST", headers: playerHeaders(player), body: JSON.stringify({ code: targetRoom.code, playerId: player.playerId, optionId }) }, expectedStatus);

  const lobbyBeforeReconnect = await stateFor(room, playerOne);
  const initialAvatar = lobbyBeforeReconnect.players.find(player => player.id === playerOne.playerId)?.avatar;
  const customBackdrops = lobbyBeforeReconnect.players.filter(player => player.avatar.character === "custom").map(player => player.avatar.accent);
  const robotBackdrops = lobbyBeforeReconnect.players.filter(player => player.avatar.character === "robot").map(player => player.avatar.accent);
  if (new Set(customBackdrops).size !== customBackdrops.length || new Set(robotBackdrops).size !== robotBackdrops.length) throw new Error("Concurrent duplicate-character joins did not receive unique room-local backdrops");
  const reconnect = (await request("/api/players/join", { method: "POST", headers: playerHeaders(playerOne), body: JSON.stringify({ code: room.code, nickname: playerOne.nickname, avatar: avatarOne, playerId: playerOne.playerId }) }, 200)).body;
  if (!reconnect.reconnected || reconnect.playerId !== playerOne.playerId) throw new Error("A valid saved player session created a duplicate instead of reconnecting");
  const lobbyAfterReconnect = await stateFor(room, playerOne);
  if (lobbyAfterReconnect.players.length !== 20) throw new Error("Reconnect changed the lobby player count");
  if (lobbyAfterReconnect.players.find(player => player.id === playerOne.playerId)?.avatar.accent !== initialAvatar?.accent) throw new Error("Reconnect changed the authoritative avatar backdrop");

  await hostAction(room, "start");
  let state = await stateFor(room, playerOne);
  if (state.room.answerCount !== 0) throw new Error("Answer counter did not start at zero");
  if (!state.clock?.receivedAt || !state.clock?.sentAt) throw new Error("Room state did not include a server-clock sample");
  const firstStartedAt = new Date(state.room.questionStartedAt).getTime();
  const firstDeadline = new Date(state.room.questionEndsAt).getTime();
  if (firstDeadline - firstStartedAt !== 60_000) throw new Error("The first question did not receive one authoritative 60-second deadline");
  const unauthenticated = await publicState(room);
  if (unauthenticated.question) throw new Error("Public room state exposed question content without a room session");
  await request(`/api/rooms/${room.code}/transition?question=0`, { headers: { "Accept": "application/json" } }, 403);
  await request(`/api/rooms/${room.code}/transition?question=0&playerId=${playerOne.playerId}`, { headers: { "Accept": "application/json", "x-player-token": playerOne.playerToken } }, 200);
  if (Date.now() < firstStartedAt) {
    const earlyAnswer = await submit(room, playerOne, state.question.options[0].id, 400);
    if (!String(earlyAnswer.body.error).includes("not started")) throw new Error("The server did not reject a pre-start answer");
  }
  const [hostClockSample, playerClockSample] = await Promise.all([
    sampledState(`/api/rooms/${room.code}/state`, { "Accept": "application/json", "x-host-token": room.hostToken }),
    sampledState(`/api/rooms/${room.code}/state?playerId=${playerOne.playerId}`, playerHeaders(playerOne), 18_000)
  ]);
  if (hostClockSample.body.room.questionEndsAt !== playerClockSample.body.room.questionEndsAt) throw new Error("Host and player received different question deadlines");
  const comparisonMonotonicMs = performance.now();
  const hostRemaining = firstDeadline - (hostClockSample.serverTimeMs + comparisonMonotonicMs - hostClockSample.monotonicTimeMs);
  const playerRemaining = firstDeadline - (playerClockSample.serverTimeMs + comparisonMonotonicMs - playerClockSample.monotonicTimeMs);
  timings.timerDifferenceMs = Math.round(Math.abs(hostRemaining - playerRemaining));
  if (timings.timerDifferenceMs > 1_000) throw new Error(`Calibrated host/player timers differed by ${timings.timerDifferenceMs}ms`);
  const savedAvatars = new Map(state.players.map(player => [player.nickname, player.avatar]));
  if (savedAvatars.get("CorrectTester")?.base !== avatarOne.base || savedAvatars.get("CorrectTester")?.character !== "custom" || savedAvatars.get("WrongTester")?.character !== avatarTwo.character) throw new Error("Legacy or themed player avatar configuration did not persist");
  await waitForQuestionStart(state);
  const submitStarted = performance.now();
  await Promise.all(joinedPlayers.slice(0, 19).map((player, index) => submit(room, player, state.question.options[index === 0 ? 0 : 1].id)));
  timings.concurrentSubmitMs = Math.round(performance.now() - submitStarted);
  await submit(room, playerOne, state.question.options[0].id, 400);
  state = await stateFor(room, playerOne);
  const hostCounterAfterBatch = await hostState(room);
  if (hostCounterAfterBatch.room.answerCount !== 19) throw new Error(`Host answer counter reached ${hostCounterAfterBatch.room.answerCount}/20 instead of 19/20`);
  if (state.players.some(player => player.score !== 0)) throw new Error("A score changed before reveal");
  if ((await publicState(room)).players.some(player => player.score !== 0 || player.correctAnswers !== 0 || player.streak !== 0)) throw new Error("Public room state exposed standings before completion");

  const revealStarted = performance.now();
  await hostAction(room, "reveal");
  timings.revealMs = Math.round(performance.now() - revealStarted);
  const correctReveal = await stateFor(room, playerOne);
  const wrongReveal = await stateFor(room, playerTwo);
  if (!correctReveal.me.wasCorrect || correctReveal.me.lastPoints !== 5 || correctReveal.me.score !== 5) throw new Error("Correct fixed-point scoring failed");
  if (wrongReveal.me.wasCorrect !== false || wrongReveal.me.lastPoints !== 0 || wrongReveal.me.score !== 0) throw new Error("Wrong-answer scoring failed");
  if (correctReveal.players.some(player => player.score !== 0 || player.correctAnswers !== 0 || player.streak !== 0)) throw new Error("Player room state exposed standings during reveal");
  const visibleHostState = await hostState(room);
  if (visibleHostState.players.find(player => player.id === playerOne.playerId)?.score !== 5) throw new Error("Authenticated host could not see live standings");

  await hostAction(room, "next");
  state = await stateFor(room, playerOne);
  const secondStartedAt = new Date(state.room.questionStartedAt).getTime();
  const secondDeadline = new Date(state.room.questionEndsAt).getTime();
  if (secondDeadline - secondStartedAt !== 60_000 || secondDeadline === firstDeadline) throw new Error("The next question did not receive a fresh authoritative 60-second deadline");
  const finalOptionId = state.question.options[0].id;
  await waitForQuestionStart(state);
  await submit(room, playerOne, finalOptionId);
  state = await stateFor(room, playerOne);
  const hostCounterAfterSecondAnswer = await hostState(room);
  if (hostCounterAfterSecondAnswer.room.answerCount !== 1) throw new Error(`Second-question host answer counter reached ${hostCounterAfterSecondAnswer.room.answerCount}/20 instead of 1/20`);
  await hostAction(room, "reveal");
  const secondCorrect = await stateFor(room, playerOne);
  const unanswered = await stateFor(room, playerTwo);
  if (secondCorrect.me.score !== 10 || secondCorrect.me.lastPoints !== 5) throw new Error("Leaderboard total did not use fixed points");
  if (unanswered.me.answered || unanswered.me.lastPoints !== 0 || unanswered.me.score !== 0) throw new Error("Unanswered scoring failed");
  await hostAction(room, "next");
  const finished = await stateFor(room, playerOne);
  if (finished.room.status !== "finished") throw new Error("Quiz did not reach final results");
  if (finished.players.find(player => player.id === playerOne.playerId)?.score !== 10) throw new Error("Final standings were not revealed to players");

  await hostAction(room, "end");
  const repeatedEnd = await hostAction(room, "end");
  if (!repeatedEnd.alreadyEnded) throw new Error("Repeated end action was not handled idempotently");
  const ended = await stateFor(room, playerOne);
  if (ended.room.status !== "ended") throw new Error("Players did not receive the explicit ended state");
  const oldCodeLookup = await request(`/api/rooms/${room.code}`, { headers: { "Accept": "application/json" } }, 410);
  if (oldCodeLookup.body.error !== "This room has ended.") throw new Error("Ended room lookup did not return a clear error");
  const endedJoin = await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ code: room.code, nickname: "LatePlayer", avatar: avatarOne }) }, 410);
  if (endedJoin.body.error !== "This room has ended.") throw new Error("Ended room accepted or misreported a late join");
  await submit(room, playerOne, finalOptionId, 400);

  latestRoom = (await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: quizHeaders }, 201)).body;
  if (latestRoom.roomId === room.roomId || latestRoom.code === room.code) throw new Error("A newly hosted session reused the previous room identity");
  const isolatedAvatar = { ...avatarTwo, accent: "#FF6846" };
  const isolatedPlayer = (await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ code: latestRoom.code, nickname: "IsolationTester", avatar: isolatedAvatar }) }, 201)).body;
  const isolatedLobby = await stateFor(latestRoom, isolatedPlayer);
  if (isolatedLobby.players.length !== 1 || isolatedLobby.players[0].nickname !== "IsolationTester") throw new Error("Previous-room participants leaked into the new room");
  if (isolatedLobby.players[0].score !== 0 || isolatedLobby.players[0].streak !== 0 || isolatedLobby.players[0].correctAnswers !== 0) throw new Error("New-room leaderboard did not start at zero");
  if (isolatedLobby.players[0].avatar.character !== "robot" || isolatedLobby.players[0].avatar.accent !== "#FF6846") throw new Error("Preset background customization did not persist");
  const staleSessionView = await stateFor(latestRoom, playerOne);
  if (staleSessionView.me || staleSessionView.players.some(player => player.id === playerOne.playerId)) throw new Error("A stale player session crossed the room boundary");
  await hostAction(latestRoom, "end");
  const isolatedEnded = await stateFor(latestRoom, isolatedPlayer);
  if (isolatedEnded.room.status !== "ended") throw new Error("A lobby room did not end cleanly");

  const shortQuiz = { ...exported, questions: [{ ...exported.questions[0], timeLimit: 5 }] };
  await request(`/api/quizzes/${quiz.quizId}`, { method: "PUT", headers: { ...quizHeaders, "Content-Type": "application/json" }, body: JSON.stringify(shortQuiz) }, 200);
  deadlineRoom = (await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: quizHeaders }, 201)).body;
  const deadlinePlayer = (await request("/api/players/join", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ code: deadlineRoom.code, nickname: "DeadlineTester", avatar: avatarOne }) }, 201)).body;
  await hostAction(deadlineRoom, "start");
  const deadlineState = await stateFor(deadlineRoom, deadlinePlayer);
  if (new Date(deadlineState.room.questionEndsAt).getTime() - new Date(deadlineState.room.questionStartedAt).getTime() !== 5_000) throw new Error("Short deadline fixture did not receive the configured duration");
  await new Promise(resolve => setTimeout(resolve, Math.max(0, new Date(deadlineState.room.questionEndsAt).getTime() - Date.now()) + 1_000));
  const lateAnswer = await submit(deadlineRoom, deadlinePlayer, deadlineState.question.options[0].id, 400);
  if (!String(lateAnswer.body.error).includes("Time is up")) throw new Error("The server did not reject an answer submitted after the authoritative deadline");
  await hostAction(deadlineRoom, "end");

  await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: quizHeaders }, 200);
  quiz = undefined;

  const legacyDocument = { ...quizDocument, title: `Legacy ${Date.now()}` };
  delete legacyDocument.pointsPerCorrectAnswer;
  const legacy = (await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(legacyDocument) }, 201)).body;
  const legacyHeaders = { "x-quiz-token": legacy.quizToken, "Accept": "application/json" };
  const legacyExport = (await request(`/api/quizzes/${legacy.quizId}`, { headers: legacyHeaders }, 200)).body;
  if (legacyExport.pointsPerCorrectAnswer !== 1) throw new Error("Legacy JSON default failed");
  await request(`/api/quizzes/${legacy.quizId}`, { method: "DELETE", headers: legacyHeaders }, 200);

  console.log(`Regression smoke test passed: ${timings.timerDifferenceMs}ms calibrated host/player timer difference with an 18s simulated client skew, authenticated question hydration, hidden public questions, shared 60-second deadlines, fresh next-question deadline, server-rejected early/late answers, 20-player concurrent duplicate-avatar assignment, ${timings.concurrentSubmitMs}ms concurrent submit batch, ${timings.revealMs}ms reveal, avatar-preserving reconnect, rejected old-code join, private in-quiz rankings, host standings, library, create, edit, isolated rehosting, idempotent room ending, blocked post-end answers, legacy/themed avatar persistence, fixed scoring, answer counter, reveal feedback, final results, legacy JSON, and deletion.`);
} finally {
  if (quiz) {
    try {
      if (deadlineRoom) await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "x-host-token": deadlineRoom.hostToken }, body: JSON.stringify({ code: deadlineRoom.code, action: "end" }) });
      if (latestRoom) await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "x-host-token": latestRoom.hostToken }, body: JSON.stringify({ code: latestRoom.code, action: "end" }) });
      if (room) await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "x-host-token": room.hostToken }, body: JSON.stringify({ code: room.code, action: "end" }) });
      await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: { "x-quiz-token": quiz.quizToken, "Accept": "application/json" } });
    } catch { /* Preserve the original test failure. */ }
  }
}
