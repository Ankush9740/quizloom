import assert from "node:assert/strict";
import { rankPlayers } from "../lib/player-ranking.ts";
import { deadlineRemainingMs, estimateServerClock, timeUntilStartMs } from "../lib/server-clock.ts";
import { portableQuizSchema } from "../lib/validation.ts";

const avatar = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
const player = (id, nickname, score, correctAnswers, correctResponseTimeMs, speedRankingEnabled = true) => ({
  id, nickname, avatar, score, correctAnswers, streak: 0, correctResponseTimeMs, speedRankingEnabled
});

const ranked = rankPlayers([
  player("ayush", "Ayush", 20, 2, 8_200),
  player("ankush", "Ankush", 30, 3, 15_800),
  player("rahul", "Rahul", 30, 3, 12_400)
]);
assert.deepEqual(ranked.map(item => item.id), ["rahul", "ankush", "ayush"], "Score must rank first and cumulative correct-answer time must break equal-score ties");

const exactTie = rankPlayers([
  player("b", "Zed", 10, 1, 2_000),
  player("a", "Amy", 10, 1, 2_000)
]);
assert.deepEqual(exactTie.map(item => item.id), ["a", "b"], "Exact ties must use a deterministic name/ID order");

const zeroCorrect = rankPlayers([
  player("zero", "Aaron", 5, 0, null),
  player("timed", "Zoe", 5, 1, 4_000)
]);
assert.equal(zeroCorrect[0].id, "timed", "A zero-correct player must not gain a false 0ms speed advantage");

const historical = rankPlayers([
  player("few", "Aaron", 30, 2, null, false),
  player("more", "Zoe", 30, 3, null, false)
]);
assert.equal(historical[0].id, "more", "Historical rooms must retain the legacy correct-answer tie-break");

const baseQuiz = {
  version: 1,
  title: "Custom timer regression",
  description: "",
  pointsPerCorrectAnswer: 1,
  questions: [{ question: "Which answer is correct?", options: ["A", "B", "C", "D"], correctAnswer: 0, timeLimit: 20 }]
};
for (const duration of [5, 15, 45, 75, 120, 300]) {
  assert.equal(portableQuizSchema.parse({ ...baseQuiz, questions: [{ ...baseQuiz.questions[0], timeLimit: duration }] }).questions[0].timeLimit, duration);
}
for (const duration of [undefined, null, 0, -1, 4, 5.5, 301, Number.NaN]) {
  assert.equal(portableQuizSchema.safeParse({ ...baseQuiz, questions: [{ ...baseQuiz.questions[0], timeLimit: duration }] }).success, false, `Invalid timer ${String(duration)} was accepted`);
}

const sample = { receivedAt: new Date(1_000_100).toISOString(), sentAt: new Date(1_000_200).toISOString() };
const clock = estimateServerClock(sample, 1_018_000, 1_018_400, 5_000);
assert.ok(clock);
const start = new Date(1_003_000).toISOString();
const end = new Date(1_078_000).toISOString();
assert.ok(timeUntilStartMs(start, clock, 5_000, 1_018_400) > 2_000, "The synchronized future start should be represented explicitly");
assert.ok(deadlineRemainingMs(end, clock, 5_000, 1_018_400) > 77_000, "The deadline must remain anchored to the same server clock");

console.log("Multiplayer improvements unit regression passed: speed ranking, zero-correct fairness, historical fallback, deterministic ties, 5–300 second validation, and synchronized future timing.");
