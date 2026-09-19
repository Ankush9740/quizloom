import assert from "node:assert/strict";
import { applyAcceptedAnswer, applyHostRevealState, applyPlayerReveal, applyQuestionTransition } from "../lib/room-client-state.ts";

const player = {
  id: "player-a",
  nickname: "Ada",
  avatar: { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" },
  score: 0,
  correctAnswers: 0,
  streak: 0
};
const lobby = {
  clock: { receivedAt: new Date(0).toISOString(), sentAt: new Date(0).toISOString() },
  room: { id: "room-a", code: "123456", title: "Regression", status: "lobby", currentQuestion: -1, questionCount: 2, questionStartedAt: null, questionEndsAt: null, answerCount: 0 },
  players: [player]
};
const firstQuestion = {
  room: { status: "question", currentQuestion: 0, questionStartedAt: new Date(1_000).toISOString(), questionEndsAt: new Date(61_000).toISOString(), answerCount: 0 },
  question: { id: "question-a", number: 1, prompt: "Choose", timeLimit: 60, options: [
    { id: "option-a", text: "A", position: 0 },
    { id: "option-b", text: "B", position: 1 }
  ] }
};

// This reproduces the regression: the lobby payload had players but no `me`.
// A question transition must still create personalized state for the player.
const active = applyQuestionTransition(lobby, firstQuestion, 0, player.id);
assert.equal(active.room.status, "question");
assert.equal(active.me?.id, player.id);
assert.equal(active.me?.answered, false);
assert.equal(active.question?.correctOptionId, undefined, "Correctness must stay hidden before reveal");

const answered = applyAcceptedAnswer(active, player.id, "option-b");
assert.equal(answered.me?.answered, true);
assert.equal(answered.me?.selectedOptionId, "option-b", "The accepted selection must remain visibly identifiable");

const incorrectReveal = {
  answered: true,
  selectedOptionId: "option-b",
  wasCorrect: false,
  lastPoints: 0,
  score: 0,
  correctAnswers: 0,
  streak: 0,
  correctOptionId: "option-a"
};
const results = applyPlayerReveal(answered, player.id, incorrectReveal);
assert.equal(results.room.status, "results");
assert.equal(results.me?.wasCorrect, false);
assert.equal(results.me?.lastPoints, 0);
assert.equal(results.question?.correctOptionId, "option-a");

const duplicateReveal = applyPlayerReveal(results, player.id, incorrectReveal);
assert.deepEqual(duplicateReveal, results, "Duplicate reveal delivery must not add points or change results");
assert.equal(applyQuestionTransition(results, firstQuestion, 0, player.id), results, "A delayed question event must not overwrite revealed results");

const hostResults = applyHostRevealState(active, "option-a", [
  { ...player, score: 7, correctAnswers: 1, streak: 1 },
  { ...player, id: "player-b", nickname: "Ben", score: 0 },
  { ...player, id: "player-c", nickname: "Cy", score: 0 }
]);
assert.equal(hostResults.room.status, "results");
assert.equal(hostResults.players.find(item => item.id === player.id)?.score, 7, "Host leaderboard must use post-reveal authoritative scores");
assert.equal(hostResults.players.find(item => item.id === "player-b")?.score, 0);
assert.equal(hostResults.players.find(item => item.id === "player-c")?.score, 0);

const secondQuestion = {
  room: { ...firstQuestion.room, currentQuestion: 1, answerCount: 0 },
  question: { ...firstQuestion.question, id: "question-b", number: 2 }
};
const next = applyQuestionTransition(results, secondQuestion, 1, player.id);
assert.equal(next.me?.answered, false);
assert.equal(next.me?.selectedOptionId, undefined);
assert.equal(next.me?.wasCorrect, undefined);

const correct = applyPlayerReveal(applyAcceptedAnswer(next, player.id, "option-a"), player.id, {
  ...incorrectReveal,
  selectedOptionId: "option-a",
  wasCorrect: true,
  lastPoints: 5,
  score: 5,
  correctAnswers: 1,
  streak: 1
});
assert.equal(correct.me?.lastPoints, 5);
assert.equal(correct.me?.score, 5);
assert.equal(correct.me?.correctAnswers, 1);

const unanswered = applyPlayerReveal(next, player.id, {
  ...incorrectReveal,
  answered: false,
  selectedOptionId: null,
  wasCorrect: null
});
assert.equal(unanswered.me?.answered, false);
assert.equal(unanswered.me?.lastPoints, 0);
assert.equal(unanswered.me?.selectedOptionId, undefined);

console.log("Multiplayer state regression passed: selection, reveal, scoring views, next-question reset, and stale/duplicate events are safe.");
