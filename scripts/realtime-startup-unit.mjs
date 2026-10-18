import assert from "node:assert/strict";
import { classifyRealtimeSystemError, runInBatches, waitForRealtimeSubscription } from "./lib/realtime-startup.mjs";

assert.equal(classifyRealtimeSystemError({ status: "error", message: "too_many_joins" }), "channel-join-rate-limit");
assert.equal(classifyRealtimeSystemError({ status: "error", message: "Too many connected users" }), "connection-limit");
assert.equal(classifyRealtimeSystemError({ status: "error", message: "Replication connection was not established in time" }), "replication-error");
assert.equal(classifyRealtimeSystemError({ status: "ok", message: "ready" }), null);

let active = 0;
let maxActive = 0;
const waits = [];
await runInBatches(Array.from({ length: 10 }, (_, index) => index), async () => {
  active++;
  maxActive = Math.max(maxActive, active);
  await Promise.resolve();
  active--;
}, { batchSize: 4, staggerMs: 300, wait: async value => { waits.push(value); } });
assert.equal(maxActive, 4, "startup concurrency must remain bounded by the cohort size");
assert.deepEqual(waits, [300, 300], "cohorts must be paced without sleeping after the last cohort");

const recoveredHealth = { lastStatus: "CREATED", statusChanges: 0, subscribedCount: 0, reconnects: 0, failures: 0, lastFailureType: null };
const recoveringChannel = {
  subscribe(callback) {
    callback("TIMED_OUT");
    queueMicrotask(() => callback("SUBSCRIBED"));
  }
};
await waitForRealtimeSubscription(recoveringChannel, recoveredHealth, {
  timeoutMs: 50,
  diagnostics: () => "unit-test"
});
assert.equal(recoveredHealth.failures, 1, "a transient SDK timeout must remain visible in diagnostics");
assert.equal(recoveredHealth.lastStatus, "SUBSCRIBED", "the SDK's automatic rejoin must be allowed to recover");

const closedHealth = { lastStatus: "CREATED", statusChanges: 0, subscribedCount: 0, reconnects: 0, failures: 0, lastFailureType: null };
await assert.rejects(
  waitForRealtimeSubscription({ subscribe: callback => callback("CLOSED") }, closedHealth, {
    timeoutMs: 50,
    diagnostics: () => "unit-test"
  }),
  /subscription closed/
);

console.log("Realtime startup unit checks passed: cohort concurrency, pacing, transient recovery, and terminal closure handling are safe.");
