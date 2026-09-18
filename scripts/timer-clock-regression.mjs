import assert from "node:assert/strict";
import { deadlineRemainingMs, estimateServerClock } from "../lib/server-clock.ts";

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

console.log(`Timer clock regression passed: 18s wall-clock skew corrected within ${Math.abs(initialRemaining - 58_700)}ms under delayed/asymmetric delivery.`);
