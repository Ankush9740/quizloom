import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derivePresenceState, equalStringSets } from "../lib/presence-state.ts";

const presence = {
  host: [{ role: "host" }],
  one: [{ role: "player", playerId: "player-one" }],
  two: [{ role: "player", playerId: "player-two" }, { role: "player", playerId: "player-two" }]
};

const hostView = derivePresenceState(presence, "host");
assert.equal(hostView.hostOnline, true);
assert.deepEqual([...hostView.onlineIds].sort(), ["player-one", "player-two"]);

const playerView = derivePresenceState(presence, "player");
assert.equal(playerView.hostOnline, true);
assert.equal(playerView.onlineIds.size, 0, "player clients must not derive an unused participant set");
assert.equal(equalStringSets(new Set(["one", "two"]), new Set(["two", "one"])), true);
assert.equal(equalStringSets(new Set(["one"]), new Set(["two"])), false);

const benchmark = readFileSync(new URL("./performance-benchmark.mjs", import.meta.url), "utf8");
for (const diagnostic of [
  "rawMatchingEvents",
  "staleOrDuplicateEvents",
  "jumpEvents",
  "skippedIntermediateCounts",
  "highestObservedCount",
  "authoritativeFinalCount"
]) {
  assert.match(benchmark, new RegExp(`\\b${diagnostic}\\b`), `counter diagnostics are missing ${diagnostic}`);
}
assert.match(benchmark, /const\s+authoritative\s*=\s*await\s+hostState\(\)/, "Realtime counter observations must be checked against authoritative state");
assert.match(benchmark, /presenceDiagnostics\s*=\s*\{\s*hostSyncs:\s*0,\s*playerSyncs:\s*0,\s*successfulTrackCalls:\s*0\s*\}/, "Presence sync fan-out must be reported by role");

console.log("Phase 2D reliability checks passed.");
