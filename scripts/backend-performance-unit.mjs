import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeAnswerCounterBuckets } from "../lib/answer-counter.ts";
import { applyQuestionTransition } from "../lib/room-client-state.ts";

const first = mergeAnswerCounterBuckets([], [{ bucket: 3, count: 2 }, { bucket: 7, count: 1 }]);
assert.equal(first.total, 3);
assert.deepEqual(first.buckets, [{ bucket: 3, count: 2 }, { bucket: 7, count: 1 }]);

const outOfOrder = mergeAnswerCounterBuckets(first.buckets, [{ bucket: 3, count: 1 }, { bucket: 7, count: 4 }]);
assert.equal(outOfOrder.total, 6, "older bucket events must not roll the host count backward");
assert.deepEqual(outOfOrder.buckets, [{ bucket: 3, count: 2 }, { bucket: 7, count: 4 }]);

const previous = {
  clock: { receivedAt: new Date(0).toISOString(), sentAt: new Date(0).toISOString() },
  room: {
    id: "room", code: "123456", title: "Quiz", status: "results", currentQuestion: 0,
    questionCount: 2, questionStartedAt: null, questionEndsAt: null, answerCount: 6,
    answerBuckets: outOfOrder.buckets
  },
  players: []
};
const transitioned = applyQuestionTransition(previous, {
  room: { status: "question", currentQuestion: 1, questionStartedAt: new Date().toISOString(), questionEndsAt: new Date().toISOString(), answerCount: 0 }
}, 1);
assert.equal(transitioned.room.answerCount, 0);
assert.deepEqual(transitioned.room.answerBuckets, [], "counter buckets must reset for the next question");

const migration = readFileSync(new URL("../supabase/migrations/007_backend_performance_optimization.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /\bregistrations\b/i, "the staging registrations table must remain outside migration scope");
assert.doesNotMatch(migration, /\b(?:truncate|drop\s+table)\b/i, "the optimization migration must not destructively clear tables");
assert.doesNotMatch(migration, /create or replace function public\.submit_quiz_answer\s*\(/i, "migration 007 must preserve the legacy answer RPC for deployment compatibility");
for (const signature of ["create_quiz_room", "join_quiz_room", "submit_quiz_answer_v2", "reveal_quiz_answer_with_standings"]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${signature}\\b`));
  assert.match(migration, new RegExp(`grant execute on function public\\.${signature}\\b[\\s\\S]*?to service_role`));
}

console.log("Backend performance unit checks passed.");
