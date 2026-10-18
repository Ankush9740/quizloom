import assert from "node:assert/strict";
import { recordClientDuration, startClientTrace } from "../lib/client/performance.ts";
import { startServerTrace } from "../lib/server/performance.ts";

const request = new Request("http://localhost/api/test", {
  headers: { "x-quizloom-trace": "safe-test-trace" }
});
const serverTrace = startServerTrace(request, "test.operation");
serverTrace.mark("database");
const timedResponse = serverTrace.response(Response.json({ ok: true }));

assert.equal(timedResponse.headers.get("x-quizloom-trace"), "safe-test-trace");
assert.match(timedResponse.headers.get("server-timing") ?? "", /^total;dur=\d+(?:\.\d+)?, database;dur=\d+(?:\.\d+)?$/);

const before = performance.getEntriesByName("quizloom:test.client").length;
const clientTrace = startClientTrace("test.client");
assert.match(clientTrace.header["x-quizloom-trace"], /^[A-Za-z0-9_-]{8,80}$/);
clientTrace.finish(new Response(null, { status: 202, headers: { "server-timing": "total;dur=4.2" } }));
const entries = performance.getEntriesByName("quizloom:test.client");
assert.equal(entries.length, before + 1);
assert.ok(entries.at(-1)?.duration >= 0);

const beforeDelivery = performance.getEntriesByName("quizloom:test.delivery").length;
recordClientDuration("test.delivery", 4.2, { source: "calibrated-clock" });
const deliveryEntries = performance.getEntriesByName("quizloom:test.delivery");
assert.equal(deliveryEntries.length, beforeDelivery + 1);
assert.ok(Math.abs((deliveryEntries.at(-1)?.duration ?? 0) - 4.2) < 0.1);

console.log("Performance instrumentation unit test passed: safe trace correlation, Server-Timing headers, and browser-compatible request and Realtime Performance entries.");
