import assert from "node:assert/strict";
import { deadlineRemainingMs, estimateServerClock, getQuestionTiming } from "../lib/server-clock.ts";

// The client wall clock is 18 seconds fast. The request also experiences
// asymmetric latency and a full second of server-side processing time.
const sample = {
  receivedAt: new Date(1_000_120).toISOString(),
  sentAt: new Date(1_001_120).toISOString()
};
const clock = estimateServerClock(sample, 1_018_000, 1_019_300, 5_000);
assert.ok(clock, "A valid server-clock sample should be accepted");

const deadline = new Date(1_060_000).toISOString();
const initialRemaining = deadlineRemainingMs(deadline, clock, 5_000, 1_019_300);
assert.ok(Math.abs(initialRemaining - 58_700) <= 100, `Clock skew was not corrected: ${initialRemaining}ms remain`);

// A later wall-clock jump must not change elapsed quiz time. Once synchronized,
// elapsed time is measured only with the monotonic clock.
const afterTwentySeconds = deadlineRemainingMs(deadline, clock, 25_000, 1_129_300);
assert.equal(afterTwentySeconds, initialRemaining - 20_000);

const scheduledStart = new Date(2_003_000).toISOString();
const scheduledEnd = new Date(2_023_000).toISOString();
const countdown = getQuestionTiming(scheduledStart, scheduledEnd, null, 0, 2_000_250);
assert.equal(countdown.phase, "countdown", "Question content must remain hidden before the authoritative start");
assert.equal(countdown.seconds, 3, "Countdown must be derived from the scheduled timestamp");
const opening = getQuestionTiming(scheduledStart, scheduledEnd, null, 0, 2_003_000);
assert.equal(opening.phase, "answering", "Question content must appear at the authoritative start boundary");
assert.equal(opening.milliseconds, 20_000, "A configured 20-second question must open with the full 20-second window");
assert.equal(getQuestionTiming(scheduledStart, scheduledEnd, null, 0, 2_022_999).phase, "answering");
assert.equal(getQuestionTiming(scheduledStart, scheduledEnd, null, 0, 2_023_000).phase, "expired", "Question must close at the authoritative deadline");
const reconnected = getQuestionTiming(scheduledStart, scheduledEnd, null, 0, 2_011_000);
assert.equal(reconnected.milliseconds, 12_000, "Refresh/reconnect must reconstruct timing from server timestamps");

console.log(`Timer clock regression passed: skew correction, hidden countdown boundary, exact 20-second window, deadline closure, and reconnect reconstruction.`);
