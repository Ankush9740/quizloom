import assert from "node:assert/strict";
import fs from "node:fs";

const playerRoom = fs.readFileSync("components/player-room.tsx", "utf8");
const hostRoom = fs.readFileSync("components/host-room.tsx", "utf8");

const pendingCommit = playerRoom.indexOf("flushSync(() =>");
const answerRequest = playerRoom.indexOf('fetch("/api/answers"');
const acceptedAnswer = playerRoom.indexOf("markAnswered(optionId, questionId)");

assert.ok(pendingCommit >= 0 && pendingCommit < answerRequest, "pending answer UI must commit before the answer request starts");
assert.ok(answerRequest >= 0 && answerRequest < acceptedAnswer, "accepted-answer state must wait for the server response");
assert.match(playerRoom, /if \(!r\.ok\) throw new Error\(j\.error\);\s*markAnswered/, "failed answers must never be marked accepted");
assert.match(playerRoom, /answer\.pending-commit/);
assert.match(playerRoom, /answer\.pending-frame/);
assert.match(playerRoom, /aria-busy=\{pending\}/);
assert.match(playerRoom, /touch-manipulation/);

assert.match(hostRoom, /pendingAction === "reveal"[\s\S]*Revealing…/);
assert.match(hostRoom, /pendingAction === "next"[\s\S]*Loading next question…/);
assert.match(hostRoom, /pendingAction === "next"[\s\S]*Preparing podium…/);
assert.match(hostRoom, /finally \{ setPendingAction\(null\); \}/);

console.log("Mobile interaction unit passed: taps commit pending feedback before network work, acceptance remains authoritative, and host transitions expose clear pending states.");
