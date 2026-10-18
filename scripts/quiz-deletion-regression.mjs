import { loadStagingEnvironment } from "./lib/staging-environment.mjs";

const staging = loadStagingEnvironment({ argv: process.argv.slice(2), requireWriteConfirmation: true });
const identityResponse = await fetch(`${staging.baseUrl}/api/benchmark/identity`, { cache: "no-store" });
if (!identityResponse.ok) throw new Error(`Staging identity endpoint returned ${identityResponse.status}`);
const identity = await identityResponse.json();
if (identity.environment !== "staging" || identity.projectRef !== staging.stagingProjectRef || !identity.benchmarkWritesEnabled) {
  throw new Error("The running application and deletion regression are not targeting the same write-enabled staging project");
}

async function request(path, options = {}, expectedStatus) {
  const response = await fetch(`${staging.baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${path} returned ${contentType || "no content type"}`);
  const body = await response.json();
  if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${body.error ?? "request failed"}`);
  return body;
}

const documentFor = title => ({
  version: 1,
  title,
  description: "Disposable room-lifecycle deletion regression",
  pointsPerCorrectAnswer: 1,
  questions: [{ question: "Which answer completes this lifecycle test?", options: ["Correct", "Wrong", "Also wrong", "Still wrong"], correctAnswer: 0, timeLimit: 5 }]
});
const fixtures = [];

async function createFixture(label) {
  const quiz = await request("/api/quizzes", {
    method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(documentFor(`Deletion ${label} ${Date.now()}`))
  }, 201);
  fixtures.push(quiz);
  return quiz;
}

const quizHeaders = quiz => ({ "x-quiz-token": quiz.quizToken, "Accept": "application/json" });
const hostRoom = quiz => request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: quizHeaders(quiz) }, 201);
const hostAction = (room, action) => request("/api/host/action", {
  method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "x-host-token": room.hostToken }, body: JSON.stringify({ code: room.code, action })
}, 200);
const endOwnedRooms = quiz => request(`/api/quizzes/${quiz.quizId}`, {
  method: "PATCH", headers: { ...quizHeaders(quiz), "Content-Type": "application/json" }, body: JSON.stringify({ action: "end-active-rooms" })
}, 200);
const deleteQuiz = (quiz, expectedStatus) => request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: quizHeaders(quiz) }, expectedStatus);

try {
  const activeQuiz = await createFixture("active");
  const lobbyRoom = await hostRoom(activeQuiz);
  const activeConflict = await deleteQuiz(activeQuiz, 409);
  if (activeConflict.activeRooms?.length !== 1 || activeConflict.activeRooms[0].code !== lobbyRoom.code || activeConflict.activeRooms[0].status !== "lobby") {
    throw new Error("A live lobby was not reported accurately as the deletion conflict");
  }
  await request(`/api/quizzes/${activeQuiz.quizId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "Accept": "application/json", "x-quiz-token": "invalid" }, body: JSON.stringify({ action: "end-active-rooms" })
  }, 403);
  const endedLobby = await endOwnedRooms(activeQuiz);
  if (endedLobby.endedRoomCount !== 1 || endedLobby.endedRoomCodes[0] !== lobbyRoom.code) throw new Error("Quiz ownership did not end exactly the active lobby");
  const endedState = await request(`/api/rooms/${lobbyRoom.code}/state`, { headers: { "x-host-token": lobbyRoom.hostToken, "Accept": "application/json" } }, 200);
  if (endedState.room.status !== "ended") throw new Error("An explicitly ended room did not expose the ended lifecycle state");
  await deleteQuiz(activeQuiz, 200);
  fixtures.splice(fixtures.indexOf(activeQuiz), 1);

  const finishedQuiz = await createFixture("finished");
  const finishedRoom = await hostRoom(finishedQuiz);
  const transition = (await hostAction(finishedRoom, "start")).transition;
  const questionConflict = await deleteQuiz(finishedQuiz, 409);
  if (questionConflict.activeRooms?.[0]?.status !== "question") throw new Error("An answering room did not block deletion");
  await new Promise(resolve => setTimeout(resolve, Math.max(0, new Date(transition.room.questionStartedAt).getTime() - Date.now()) + 100));
  await hostAction(finishedRoom, "reveal");
  const resultsConflict = await deleteQuiz(finishedQuiz, 409);
  if (resultsConflict.activeRooms?.[0]?.status !== "results") throw new Error("A revealed active room did not block deletion");
  await hostAction(finishedRoom, "next");
  await deleteQuiz(finishedQuiz, 200);
  fixtures.splice(fixtures.indexOf(finishedQuiz), 1);

  const rehostedQuiz = await createFixture("rehosted");
  const previousRoom = await hostRoom(rehostedQuiz);
  await hostAction(previousRoom, "end");
  const currentRoom = await hostRoom(rehostedQuiz);
  const rehostConflict = await deleteQuiz(rehostedQuiz, 409);
  if (rehostConflict.activeRooms?.length !== 1 || rehostConflict.activeRooms[0].code !== currentRoom.code) {
    throw new Error("A previously ended room blocked deletion or the current rehost was not identified");
  }
  await endOwnedRooms(rehostedQuiz);
  await deleteQuiz(rehostedQuiz, 200);
  fixtures.splice(fixtures.indexOf(rehostedQuiz), 1);

  console.log("Quiz deletion regression passed: lobby/question/results rooms block deletion, ownership is enforced, explicitly ended and naturally finished rooms do not block, and rehosting reports only the current active room.");
} finally {
  for (const quiz of fixtures) {
    try { await endOwnedRooms(quiz); } catch {}
    try { await deleteQuiz(quiz, 200); } catch {}
  }
}
