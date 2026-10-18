import assert from "node:assert/strict";
import { observeScheduledStart } from "./lib/benchmark-clock.mjs";

function sample({ startAt, serverReceivedAt, serverSentAt, clientSentAt, clientReceivedAt }) {
  return {
    body: {
      clock: { receivedAt: new Date(serverReceivedAt).toISOString(), sentAt: new Date(serverSentAt).toISOString() },
      room: { questionStartedAt: new Date(startAt).toISOString(), questionEndsAt: new Date(startAt + 20_000).toISOString() }
    },
    clientSentWallMs: clientSentAt,
    clientReceivedWallMs: clientReceivedAt
  };
}

// The client clock is 18 seconds fast. Symmetric 100 ms network legs and
// 200 ms server processing should still produce 800 ms corrected headroom.
const ready = observeScheduledStart(sample({
  startAt: 2_001_200,
  serverReceivedAt: 2_000_100,
  serverSentAt: 2_000_300,
  clientSentAt: 2_018_000,
  clientReceivedAt: 2_018_400
}));
assert.ok(ready);
assert.equal(ready.headroomMs, 800);
assert.equal(ready.uncertaintyMs, 100);
assert.equal(ready.classification, "confirmedReady");
assert.equal(ready.authoritativeDurationMs, 20_000);

const uncertain = observeScheduledStart(sample({
  startAt: 2_000_350,
  serverReceivedAt: 2_000_100,
  serverSentAt: 2_000_300,
  clientSentAt: 2_018_000,
  clientReceivedAt: 2_018_400
}));
assert.equal(uncertain?.classification, "uncertain");

const late = observeScheduledStart(sample({
  startAt: 2_000_050,
  serverReceivedAt: 2_000_100,
  serverSentAt: 2_000_300,
  clientSentAt: 2_018_000,
  clientReceivedAt: 2_018_400
}));
assert.equal(late?.classification, "confirmedLate");
assert.equal(observeScheduledStart({ body: {}, clientSentWallMs: 0, clientReceivedWallMs: 1 }), null);

console.log("Benchmark clock unit passed: clock skew correction, uncertainty bounds, readiness classification, and exact authoritative duration.");
