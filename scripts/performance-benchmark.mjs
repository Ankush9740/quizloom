import { createClient } from "@supabase/supabase-js";
import { loadStagingEnvironment } from "./lib/staging-environment.mjs";
import { classifyRealtimeSystemError, runInBatches, waitForRealtimeSubscription } from "./lib/realtime-startup.mjs";

const argv = process.argv.slice(2);
const staging = loadStagingEnvironment({ argv, requireWriteConfirmation: true });
const baseUrl = staging.baseUrl;
const mode = argv.find(argument => argument.startsWith("--mode="))?.split("=")[1] ?? "optimized";
const delivery = argv.find(argument => argument.startsWith("--delivery="))?.split("=")[1] ?? "realtime";
const playerCounts = (argv.find(argument => argument.startsWith("--players="))?.split("=")[1] ?? "2,10,20,50").split(",").map(Number);
const questionCount = Number(argv.find(argument => argument.startsWith("--questions="))?.split("=")[1] ?? 6);
const runCount = Number(argv.find(argument => argument.startsWith("--runs="))?.split("=")[1] ?? 3);
const realtimeConnectBatchSize = Number(argv.find(argument => argument.startsWith("--realtime-connect-batch-size="))?.split("=")[1] ?? 4);
const realtimeConnectStaggerMs = Number(argv.find(argument => argument.startsWith("--realtime-connect-stagger-ms="))?.split("=")[1] ?? 300);
const realtimePresenceBatchSize = Number(argv.find(argument => argument.startsWith("--realtime-presence-batch-size="))?.split("=")[1] ?? 1);
const realtimePresenceStaggerMs = Number(argv.find(argument => argument.startsWith("--realtime-presence-stagger-ms="))?.split("=")[1] ?? 1_100);

if (!["legacy", "optimized"].includes(mode)) throw new Error("--mode must be legacy or optimized");
if (!["realtime", "direct"].includes(delivery)) throw new Error("--delivery must be realtime or direct");
if (!playerCounts.length || playerCounts.some(count => !Number.isInteger(count) || count < 1 || count > 50)) throw new Error("--players must contain integers from 1 through 50");
if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 50) throw new Error("--questions must be an integer from 1 through 50");
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 20) throw new Error("--runs must be an integer from 1 through 20");
if (!Number.isInteger(realtimeConnectBatchSize) || realtimeConnectBatchSize < 1 || realtimeConnectBatchSize > 10) throw new Error("--realtime-connect-batch-size must be an integer from 1 through 10");
if (!Number.isInteger(realtimeConnectStaggerMs) || realtimeConnectStaggerMs < 0 || realtimeConnectStaggerMs > 5_000) throw new Error("--realtime-connect-stagger-ms must be an integer from 0 through 5000");
if (!Number.isInteger(realtimePresenceBatchSize) || realtimePresenceBatchSize < 1 || realtimePresenceBatchSize > 10) throw new Error("--realtime-presence-batch-size must be an integer from 1 through 10");
if (!Number.isInteger(realtimePresenceStaggerMs) || realtimePresenceStaggerMs < 0 || realtimePresenceStaggerMs > 5_000) throw new Error("--realtime-presence-stagger-ms must be an integer from 0 through 5000");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const avatar = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const REALTIME_WAIT_TIMEOUT_MS = 20_000;
const REALTIME_LATE_DIAGNOSTIC_MS = 5_000;
const networkRequestCounts = new Map();
const observedVercelRegions = new Set();

function waitWithTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(typeof message === "function" ? message() : message)), REALTIME_WAIT_TIMEOUT_MS);
    promise.then(
      value => { clearTimeout(timeout); resolve(value); },
      error => { clearTimeout(timeout); reject(error); }
    );
  });
}

function parseServerTiming(value) {
  const timings = {};
  for (const part of value.split(",")) {
    const match = part.trim().match(/^([A-Za-z0-9_-]+);dur=([0-9.]+)$/);
    if (match) timings[match[1]] = Number(match[2]);
  }
  return timings;
}

function requestKey(path, options) {
  const pathname = new URL(path, baseUrl).pathname
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/\d{6}(?=\/|$)/g, "/:code");
  return `${options.method ?? "GET"} ${pathname}`;
}

async function request(path, options = {}, expectedStatus) {
  const key = requestKey(path, options);
  networkRequestCounts.set(key, (networkRequestCounts.get(key) ?? 0) + 1);
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${path} returned ${contentType || "no content type"}`);
  const body = await response.json();
  const elapsedMs = performance.now() - startedAt;
  const vercelId = response.headers.get("x-vercel-id");
  if (vercelId) observedVercelRegions.add(vercelId.split("::")[0]);
  if (expectedStatus !== undefined ? response.status !== expectedStatus : !response.ok) {
    throw new Error(`${path} returned ${response.status}: ${body.error ?? "request failed"}`);
  }
  return { body, elapsedMs, serverTiming: parseServerTiming(response.headers.get("server-timing") ?? "") };
}

async function verifyStagingApplication() {
  const response = await request("/api/benchmark/identity", { headers: { Accept: "application/json" }, cache: "no-store" }, 200);
  const identity = response.body;
  if (identity.environment !== "staging" || identity.projectRef !== staging.stagingProjectRef || !identity.benchmarkWritesEnabled) {
    throw new Error("The target application did not confirm the same write-enabled staging Supabase project");
  }
  return { vercelRegion: identity.vercelRegion ?? null, supabaseRegion: identity.supabaseRegion ?? staging.supabaseRegion };
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(values) {
  if (!values.length) return { samples: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const result = {
    samples: values.length,
    averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10,
    p50Ms: Math.round(percentile(sorted, 0.5) * 10) / 10
  };
  if (values.length >= 20) result.p95Ms = Math.round(percentile(sorted, 0.95) * 10) / 10;
  if (values.length >= 100) result.p99Ms = Math.round(percentile(sorted, 0.99) * 10) / 10;
  return result;
}

function makeMetrics() {
  return {
    actionHttp: [], serverTotal: [], networkAndClientOverhead: [], followupServerTotal: [], followupNetworkAndClientOverhead: [], realtimeAfterClick: [], realtimeAfterResponse: [],
    databaseToSubscriberApprox: [], followupHydration: [], stateReadyAfterClick: [], scheduledStartHeadroom: [],
    authoritativeDuration: [], serverStages: {}
  };
}

function recordFollowupHttp(sample, result) {
  const serverTotal = result.serverTiming.total;
  if (Number.isFinite(serverTotal)) {
    sample.followupServerTotal.push(serverTotal);
    sample.followupNetworkAndClientOverhead.push(Math.max(0, result.elapsedMs - serverTotal));
  }
  for (const [stage, duration] of Object.entries(result.serverTiming)) {
    if (stage === "total") continue;
    (sample.serverStages[`followup-${stage}`] ??= []).push(duration);
  }
}

function recordHttp(sample, result) {
  sample.actionHttp.push(result.elapsedMs);
  const serverTotal = result.serverTiming.total;
  if (Number.isFinite(serverTotal)) {
    sample.serverTotal.push(serverTotal);
    sample.networkAndClientOverhead.push(Math.max(0, result.elapsedMs - serverTotal));
  }
  for (const [stage, duration] of Object.entries(result.serverTiming)) {
    if (stage === "total") continue;
    (sample.serverStages[stage] ??= []).push(duration);
  }
}

function recordDatabaseDelivery(sample, row, eventWallTime) {
  const databaseUpdatedAt = new Date(row.updated_at ?? 0).getTime();
  const duration = eventWallTime - databaseUpdatedAt;
  if (Number.isFinite(duration) && duration >= 0 && duration < 60_000) sample.databaseToSubscriberApprox.push(duration);
}

function summarizeMetrics(metrics) {
  const result = {};
  for (const [key, values] of Object.entries(metrics)) {
    if (key === "serverStages") result.serverStages = Object.fromEntries(Object.entries(values).map(([stage, durations]) => [stage, summarize(durations)]));
    else result[key] = summarize(values);
  }
  return result;
}

function mergeMetrics(target, source) {
  for (const [operation, metrics] of Object.entries(source)) {
    const destination = target[operation] ??= makeMetrics();
    for (const [key, values] of Object.entries(metrics)) {
      if (key === "serverStages") {
        for (const [stage, durations] of Object.entries(values)) (destination.serverStages[stage] ??= []).push(...durations);
      } else destination[key].push(...values);
    }
  }
}

async function cleanupBenchmarkData(quiz, room) {
  if (!quiz) return;
  const attempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (room) {
      try {
        await request("/api/host/action", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-host-token": room.hostToken },
          body: JSON.stringify({ code: room.code, action: "end" })
        });
      } catch (error) {
        lastError = error;
      }
    }

    try {
      await request(`/api/quizzes/${quiz.quizId}`, {
        method: "DELETE",
        headers: { "x-quiz-token": quiz.quizToken }
      });
      return;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) await sleep(attempt * 250);
  }

  throw new Error(
    `Benchmark cleanup could not delete disposable quiz ${quiz.quizId} after ${attempts} attempts; staging test data may remain.`,
    { cause: lastError }
  );
}

async function runPopulation(playerCount, runNumber) {
  const quizDocument = {
    version: 1,
    title: `Performance ${playerCount} run ${runNumber} ${Date.now()}`,
    description: "Disposable staging latency benchmark",
    pointsPerCorrectAnswer: 1,
    questions: Array.from({ length: questionCount }, (_, index) => ({
      question: `Benchmark question ${index + 1}?`,
      options: ["Correct", "Wrong one", "Wrong two", "Wrong three"],
      correctAnswer: 0,
      timeLimit: 120
    }))
  };
  let quiz;
  let room;
  let activeTracker = null;
  let realtimeStartup = null;
  const clients = [];
  const channels = [];
  const connectionGroups = [];
  const realtimeChannelHealth = new Map();
  const realtimeMessages = { hostRoom: 0, hostAnswerCounters: 0, playerRoom: 0, hostPlayerRows: 0, playerPlayerRows: 0, presenceSyncs: 0 };
  const metrics = {
    quizCreate: makeMetrics(), roomCreate: makeMetrics(), join: makeMetrics(), start: makeMetrics(),
    answerSubmit: makeMetrics(), answerCounter: makeMetrics(), reveal: makeMetrics(), next: makeMetrics(),
    finish: makeMetrics(), finalStandings: makeMetrics()
  };
  const channelHealthSummary = () => {
    const entries = [...realtimeChannelHealth.values()];
    const data = entries.filter(entry => entry.kind === "data");
    const presence = entries.filter(entry => entry.kind === "presence");
    const liveData = data.filter(entry => entry.lastStatus === "SUBSCRIBED").length;
    const livePresence = presence.filter(entry => entry.lastStatus === "SUBSCRIBED").length;
    const reconnects = entries.reduce((sum, entry) => sum + entry.reconnects, 0);
    const failures = entries.reduce((sum, entry) => sum + entry.failures, 0);
    const systemErrors = entries.reduce((sum, entry) => sum + entry.systemErrors, 0);
    const unavailablePlayers = data
      .filter(entry => entry.role === "player" && entry.lastStatus !== "SUBSCRIBED")
      .map(entry => entry.playerNumber)
      .filter(Number.isInteger);
    const failureTypes = [...new Set(entries.map(entry => entry.lastFailureType).filter(Boolean))].sort();
    const systemErrorTypes = [...new Set(entries.map(entry => entry.lastSystemErrorType).filter(Boolean))].sort();
    const statuses = kind => Object.entries(entries.filter(entry => entry.kind === kind).reduce((counts, entry) => {
      counts[entry.lastStatus] = (counts[entry.lastStatus] ?? 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) => `${status}:${count}`).join(",");
    return `data channels=${liveData}/${data.length} subscribed; presence channels=${livePresence}/${presence.length} subscribed; ` +
      `data statuses=${statuses("data") || "none"}; presence statuses=${statuses("presence") || "none"}; ` +
      `reconnects=${reconnects}; failures=${failures}; unavailable player subscriptions=${unavailablePlayers.length ? unavailablePlayers.join(",") : "none"}; ` +
      `failure types=${failureTypes.length ? failureTypes.join(",") : "none"}; system errors=${systemErrors}; ` +
      `system error types=${systemErrorTypes.length ? systemErrorTypes.join(",") : "none"}`;
  };

  try {
    const quizResult = await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quizDocument) }, 201);
    recordHttp(metrics.quizCreate, quizResult);
    quiz = quizResult.body;

    const roomResult = await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: { "x-quiz-token": quiz.quizToken } }, 201);
    recordHttp(metrics.roomCreate, roomResult);
    room = roomResult.body;

    const joinResults = await Promise.all(Array.from({ length: playerCount }, async (_, index) => request("/api/players/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: room.code, nickname: `R${runNumber}P${index + 1}`, avatar })
    }, 201)));
    joinResults.forEach(result => recordHttp(metrics.join, result));
    const players = joinResults.map(result => result.body);

    if (delivery === "realtime") {
      const registerChannel = (client, channel, details) => {
        channels.push([client, channel, details.presence]);
        const health = {
          role: details.role,
          kind: details.kind,
          playerNumber: details.playerNumber,
          lastStatus: "CREATED",
          statusChanges: 0,
          subscribedCount: 0,
          reconnects: 0,
          failures: 0,
          lastFailureType: null,
          systemEvents: 0,
          systemErrors: 0,
          lastSystemErrorType: null
        };
        realtimeChannelHealth.set(channel, health);
        channel.on("system", {}, payload => {
          health.systemEvents++;
          const errorType = classifyRealtimeSystemError(payload);
          if (!errorType) return;
          health.systemErrors++;
          health.lastSystemErrorType = errorType;
        });
      };
      const hostClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      clients.push(hostClient);
      const hostChannel = hostClient.channel(`perf-host-${room.roomId}-${runNumber}`, {
        // A channel can report SUBSCRIBED before its Postgres replication
        // listener is ready. Holding the callback closes that timing gap.
        config: { postgres_changes_options: { wait: true } }
      }).on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${room.roomId}`
      }, payload => { realtimeMessages.hostRoom++; activeTracker?.onHostEvent(payload.new); }).on("postgres_changes", {
        event: "*", schema: "public", table: "room_answer_counters", filter: `room_id=eq.${room.roomId}`
      }, payload => { realtimeMessages.hostAnswerCounters++; activeTracker?.onAnswerCounterEvent?.(payload.new); }).on("postgres_changes", {
        event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.roomId}`
      }, () => { realtimeMessages.hostPlayerRows++; });
      registerChannel(hostClient, hostChannel, { role: "host", kind: "data" });
      const hostPresence = hostClient.channel(`perf-presence-${room.roomId}-${runNumber}`, { config: { presence: { key: "host" } } })
        .on("presence", { event: "sync" }, () => { realtimeMessages.presenceSyncs++; });
      registerChannel(hostClient, hostPresence, { role: "host", kind: "presence", presence: { role: "host" } });
      connectionGroups.push({
        role: "host",
        channels: [
          { channel: hostChannel, presence: null },
          { channel: hostPresence, presence: { role: "host" } }
        ]
      });

      for (let index = 0; index < playerCount; index++) {
        const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        clients.push(client);
        const channel = client.channel(`perf-player-${room.roomId}-${runNumber}-${index}`, {
          config: { postgres_changes_options: { wait: true } }
        }).on("postgres_changes", {
          // Players need phase transitions, not the host-only answer counter.
          // These non-overlapping filters retain question, reveal, and finish
          // updates without fanning each submitted answer to every player.
          event: "UPDATE", schema: "public", table: "game_rooms",
          filter: `id=eq.${room.roomId},status=eq.question,answer_count=eq.0`
        }, payload => { realtimeMessages.playerRoom++; activeTracker?.onPlayerEvent(index, payload.new); }).on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "game_rooms",
          filter: `id=eq.${room.roomId},status=in.(results,finished)`
        }, payload => { realtimeMessages.playerRoom++; activeTracker?.onPlayerEvent(index, payload.new); }).on("postgres_changes", {
          // Player clients need new lobby participants, but score updates are
          // hydrated authoritatively by reveal/final-state requests. Avoid
          // fanning every reveal update back to every simulated player.
          event: "INSERT", schema: "public", table: "players", filter: `room_id=eq.${room.roomId}`
        }, () => { realtimeMessages.playerPlayerRows++; });
        registerChannel(client, channel, { role: "player", kind: "data", playerNumber: index + 1 });
        const presence = client.channel(`perf-presence-${room.roomId}-${runNumber}`, { config: { presence: { key: players[index].playerId } } })
          .on("presence", { event: "sync" }, () => { realtimeMessages.presenceSyncs++; });
        registerChannel(client, presence, { role: "player", kind: "presence", playerNumber: index + 1, presence: { role: "player", playerId: players[index].playerId } });
        connectionGroups.push({
          role: "player",
          playerNumber: index + 1,
          channels: [
            { channel, presence: null },
            { channel: presence, presence: { role: "player", playerId: players[index].playerId } }
          ]
        });
      }
      const startupStartedAt = performance.now();
      await runInBatches(connectionGroups, async group => {
        await Promise.all(group.channels.map(({ channel }) => waitForRealtimeSubscription(
          channel,
          realtimeChannelHealth.get(channel),
          { timeoutMs: REALTIME_WAIT_TIMEOUT_MS, diagnostics: channelHealthSummary }
        )));
      }, {
        batchSize: realtimeConnectBatchSize,
        staggerMs: realtimeConnectStaggerMs
      });
      const subscriptionsReadyAt = performance.now();
      const presenceChannels = connectionGroups.flatMap(group => group.channels.filter(entry => entry.presence));
      await runInBatches(presenceChannels, async presenceChannel => {
        const trackResult = await presenceChannel.channel.track(presenceChannel.presence);
        if (trackResult !== "ok") {
          throw new Error(`Realtime presence tracking failed: ${trackResult} (${channelHealthSummary()})`);
        }
      }, {
        batchSize: realtimePresenceBatchSize,
        staggerMs: realtimePresenceStaggerMs
      });
      const presenceReadyAt = performance.now();
      realtimeStartup = {
        durationMs: Number((presenceReadyAt - startupStartedAt).toFixed(1)),
        subscriptionDurationMs: Number((subscriptionsReadyAt - startupStartedAt).toFixed(1)),
        presenceTrackDurationMs: Number((presenceReadyAt - subscriptionsReadyAt).toFixed(1)),
        clientCount: connectionGroups.length,
        channelCount: channels.length,
        batchSize: realtimeConnectBatchSize,
        staggerMs: realtimeConnectStaggerMs,
        presenceBatchSize: realtimePresenceBatchSize,
        presenceStaggerMs: realtimePresenceStaggerMs,
        transientFailures: [...realtimeChannelHealth.values()].reduce((sum, health) => sum + health.failures, 0)
      };
    }

    const stateFor = player => request(`/api/rooms/${room.code}/state?playerId=${player.playerId}`, { headers: { "x-player-token": player.playerToken } });
    const revealFor = player => request(`/api/rooms/${room.code}/reveal?playerId=${player.playerId}`, { headers: { "x-player-token": player.playerToken } });
    const hostAction = (action, signal) => request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": room.hostToken }, body: JSON.stringify({ code: room.code, action }), signal });
    const hostState = () => request(`/api/rooms/${room.code}/state`, { headers: { "x-host-token": room.hostToken } });

    async function measureTransition(kind, action, predicate, followup) {
      const sample = metrics[kind];
      const clickAt = performance.now();
      const messageBaseline = { ...realtimeMessages };
      if (delivery === "direct") {
        const actionResult = await hostAction(action);
        recordHttp(sample, actionResult);
        await Promise.all(players.map(async player => {
          const hydrateStartedAt = performance.now();
          let hydrated;
          if (followup === "state" && (mode === "legacy" || kind === "finish")) hydrated = await stateFor(player);
          else if (followup === "state") hydrated = await request(`/api/rooms/${room.code}/transition?question=${Number(actionResult.body.transition?.room?.currentQuestion)}`);
          if (followup === "reveal") hydrated = await revealFor(player);
          const readyAt = performance.now();
          sample.followupHydration.push(readyAt - hydrateStartedAt);
          sample.stateReadyAfterClick.push(readyAt - clickAt);
          if (hydrated) recordFollowupHttp(sample, hydrated);
          if ((kind === "start" || kind === "next") && hydrated?.body?.room?.questionStartedAt) {
            sample.scheduledStartHeadroom.push(new Date(hydrated.body.room.questionStartedAt).getTime() - Date.now());
            sample.authoritativeDuration.push(new Date(hydrated.body.room.questionEndsAt).getTime() - new Date(hydrated.body.room.questionStartedAt).getTime());
          }
        }));
        return actionResult.body;
      }

      let responseAt = null;
      let resolveEvents;
      const eventsComplete = new Promise(resolve => { resolveEvents = resolve; });
      const seen = new Set();
      const hydrationTasks = [];
      let hydratedCount = 0;
      let matchingBeforeResponse = 0;
      let mismatchedEvents = 0;
      let duplicateEvents = 0;
      let deliveryTimedOut = false;
      let maximumObservedLagMs = 0;
      const observedRoomStates = new Map();
      const observeRoomEvent = row => {
        const status = typeof row?.status === "string" ? row.status : "missing-status";
        const question = Number.isInteger(Number(row?.current_question)) ? Number(row.current_question) : "missing-question";
        const answerCount = Number.isInteger(Number(row?.answer_count)) ? Number(row.answer_count) : "missing-count";
        const key = `${status}/q${question}/answers${answerCount}`;
        observedRoomStates.set(key, (observedRoomStates.get(key) ?? 0) + 1);
        const updatedAt = new Date(row?.updated_at ?? 0).getTime();
        const lag = Date.now() - updatedAt;
        if (Number.isFinite(lag) && lag >= 0 && lag < 60_000) maximumObservedLagMs = Math.max(maximumObservedLagMs, lag);
      };
      const messageDeltaSummary = () => {
        const delta = Object.fromEntries(Object.entries(realtimeMessages).map(([key, value]) => [key, value - messageBaseline[key]]));
        return `transition deltas: host room=${delta.hostRoom}; player room=${delta.playerRoom}; ` +
            `host answer counters=${delta.hostAnswerCounters}; host player rows=${delta.hostPlayerRows}; ` +
            `player player rows=${delta.playerPlayerRows}; presence syncs=${delta.presenceSyncs}`;
      };
      const observedStateSummary = () => {
        if (!observedRoomStates.size) return "observed room states=none";
        return `observed room states=${[...observedRoomStates.entries()].map(([state, count]) => `${state}:${count}`).join(",")}; ` +
          `maximum observed database-to-client lag=${Math.round(maximumObservedLagMs)}ms`;
      };
      activeTracker = {
        onHostEvent(row) { observeRoomEvent(row); },
        onPlayerEvent(index, row) {
          observeRoomEvent(row);
          if (seen.has(index)) { duplicateEvents++; return; }
          if (!predicate(row)) { mismatchedEvents++; return; }
          seen.add(index);
          if (responseAt === null) matchingBeforeResponse++;
          if (seen.size === playerCount) resolveEvents();
          if (deliveryTimedOut) return;
          const eventAt = performance.now();
          sample.realtimeAfterClick.push(eventAt - clickAt);
          recordDatabaseDelivery(sample, row, Date.now());
          if (responseAt !== null) sample.realtimeAfterResponse.push(Math.max(0, eventAt - responseAt));
          const hydration = (async () => {
            const hydrateStartedAt = performance.now();
            let hydratedResponse;
            if (followup === "state" && (mode === "legacy" || kind === "finish")) hydratedResponse = await stateFor(players[index]);
            else if (followup === "state") hydratedResponse = await request(`/api/rooms/${room.code}/transition?question=${Number(row.current_question)}`);
            if (followup === "reveal") hydratedResponse = await revealFor(players[index]);
            const readyAt = performance.now();
            sample.followupHydration.push(readyAt - hydrateStartedAt);
            sample.stateReadyAfterClick.push(readyAt - clickAt);
            if (hydratedResponse) recordFollowupHttp(sample, hydratedResponse);
            if ((kind === "start" || kind === "next") && hydratedResponse?.body?.room?.questionStartedAt) {
              sample.scheduledStartHeadroom.push(new Date(hydratedResponse.body.room.questionStartedAt).getTime() - Date.now());
              sample.authoritativeDuration.push(new Date(hydratedResponse.body.room.questionEndsAt).getTime() - new Date(hydratedResponse.body.room.questionStartedAt).getTime());
            }
            hydratedCount++;
          })();
          // Attach a rejection handler immediately. Promise.all below still
          // propagates the original rejection after every event has arrived.
          void hydration.catch(() => {});
          hydrationTasks.push(hydration);
        }
      };
      const actionController = new AbortController();
      const actionTimeout = setTimeout(() => actionController.abort(), REALTIME_WAIT_TIMEOUT_MS);
      let actionResult;
      try {
        actionResult = await hostAction(action, actionController.signal);
      } catch (error) {
        if (actionController.signal.aborted) {
          throw new Error(`${kind} action response timed out before Realtime delivery could be evaluated`, { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(actionTimeout);
      }
      responseAt = performance.now();
      recordHttp(sample, actionResult);
      const authoritativeStatus = actionResult.body.transition?.room?.status ?? actionResult.body.status ?? "unknown";
      const authoritativeQuestion = actionResult.body.transition?.room?.currentQuestion ?? "unknown";
      try {
        if (seen.size < playerCount) {
          try {
            await waitWithTimeout(eventsComplete, `${kind} Realtime delivery timed out after the action response`);
          } catch {
            deliveryTimedOut = true;
            const matchingAtTimeout = seen.size;
            await Promise.race([eventsComplete, sleep(REALTIME_LATE_DIAGNOSTIC_MS)]);
            const lateMatchingEvents = seen.size - matchingAtTimeout;
            const recovery = await Promise.allSettled(players.map(stateFor));
            const recoveredPlayers = recovery.filter(result => result.status === "fulfilled" &&
              result.value.body.room.status === authoritativeStatus &&
              Number(result.value.body.room.currentQuestion) === Number(authoritativeQuestion)).length;
            const failedRecoveries = recovery.filter(result => result.status === "rejected").length;
            throw new Error(
              `${kind} Realtime delivery timed out after the action response ` +
              `(received ${matchingAtTimeout}/${playerCount} matching player room events within ${REALTIME_WAIT_TIMEOUT_MS}ms; ` +
              `late matching events in ${REALTIME_LATE_DIAGNOSTIC_MS}ms diagnostic window=${lateMatchingEvents}; ` +
              `matching before response=${matchingBeforeResponse}; mismatched=${mismatchedEvents}; duplicates=${duplicateEvents}; ` +
              `${messageDeltaSummary()}; ${observedStateSummary()}; ` +
              `authoritative status=${authoritativeStatus}; question=${authoritativeQuestion}; ` +
              `authoritative recovery=${recoveredPlayers}/${playerCount}; recovery request failures=${failedRecoveries}; ` +
              `${channelHealthSummary()})`
            );
          }
        }
        await waitWithTimeout(Promise.all(hydrationTasks), () =>
          `${kind} hydration timed out after all Realtime events arrived ` +
          `(hydrated ${hydratedCount}/${playerCount}; authoritative status=${authoritativeStatus}; question=${authoritativeQuestion})`
        );
        return actionResult.body;
      } finally {
        activeTracker = null;
      }
    }

    async function measureAnswers(questionNumber, optionId) {
      const counterSample = metrics.answerCounter;
      const clickAt = performance.now();
      let waitForFinalCounter = Promise.resolve();
      let highestAnswerCount = 0;

      if (delivery === "realtime") {
        let resolveEvent;
        waitForFinalCounter = new Promise(resolve => { resolveEvent = resolve; });
        const bucketCounts = new Map();
        activeTracker = {
          onPlayerEvent() {},
          onHostEvent() {},
          onAnswerCounterEvent(row) {
            if (Number(row.question_index) !== questionNumber) return;
            const bucket = Number(row.bucket); const count = Number(row.answer_count);
            if (!Number.isInteger(bucket) || !Number.isInteger(count) || count < 1) return;
            bucketCounts.set(bucket, Math.max(bucketCounts.get(bucket) ?? 0, count));
            const total = [...bucketCounts.values()].reduce((sum, value) => sum + value, 0);
            if (total <= highestAnswerCount) return;
            highestAnswerCount = total;
            const eventAt = performance.now();
            counterSample.realtimeAfterClick.push(eventAt - clickAt);
            counterSample.stateReadyAfterClick.push(eventAt - clickAt);
            recordDatabaseDelivery(counterSample, row, Date.now());
            if (total === playerCount) resolveEvent();
          }
        };
      }

      const submissions = await Promise.all(players.map(player => request("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-player-token": player.playerToken },
        body: JSON.stringify({ code: room.code, playerId: player.playerId, optionId })
      })));
      submissions.forEach(result => recordHttp(metrics.answerSubmit, result));

      if (delivery === "direct") {
        const hydrateStartedAt = performance.now();
        const state = await hostState();
        if (Number(state.body.room.answerCount) !== playerCount) throw new Error("Authoritative answer count did not reach the full population");
        const readyAt = performance.now();
        counterSample.followupHydration.push(readyAt - hydrateStartedAt);
        counterSample.stateReadyAfterClick.push(readyAt - clickAt);
      } else {
        try {
          await waitWithTimeout(waitForFinalCounter, () =>
            `answer counter Realtime delivery timed out ` +
            `(observed ${highestAnswerCount}/${playerCount}; host counter events=${realtimeMessages.hostAnswerCounters}; ` +
            `host room events=${realtimeMessages.hostRoom}; player room events=${realtimeMessages.playerRoom})`
          );
        } finally {
          activeTracker = null;
        }
      }
    }

    for (let question = 0; question < questionCount; question++) {
      const kind = question === 0 ? "start" : "next";
      await measureTransition(kind, kind, row => row.status === "question" && Number(row.current_question) === question, "state");
      const currentState = (await stateFor(players[0])).body;
      await sleep(Math.max(0, new Date(currentState.room.questionStartedAt).getTime() - Date.now()) + 100);
      await measureAnswers(question, currentState.question.options[0].id);
      await measureTransition("reveal", "reveal", row => row.status === "results" && Number(row.current_question) === question, "reveal");
    }

    await measureTransition("finish", "next", row => row.status === "finished" && Number(row.current_question) === questionCount - 1, "state");
    const finalStateResults = await Promise.all([hostState(), ...players.map(stateFor)]);
    finalStateResults.forEach(result => recordHttp(metrics.finalStandings, result));
    if (finalStateResults.some(result => result.body.room.status !== "finished")) throw new Error("Final standings were not authoritative for every client");
    await hostAction("end");
    return { metrics, realtimeMessages, realtimeStartup };
  } finally {
    activeTracker = null;
    await Promise.allSettled(channels.map(([client, channel]) => client.removeChannel(channel)));
    await Promise.allSettled(clients.map(client => client.removeAllChannels()));
    for (const client of clients) client.realtime.disconnect();
    await cleanupBenchmarkData(quiz, room);
    await sleep(100);
  }
}

const targetIdentity = await verifyStagingApplication();
const results = {};
for (const playerCount of playerCounts) {
  const aggregate = {};
  const realtimeStartup = [];
  const messages = { hostRoom: 0, hostAnswerCounters: 0, playerRoom: 0, hostPlayerRows: 0, playerPlayerRows: 0, presenceSyncs: 0 };
  for (let run = 1; run <= runCount; run++) {
    console.error(`Benchmarking ${playerCount} players, run ${run}/${runCount}...`);
    const result = await runPopulation(playerCount, run);
    mergeMetrics(aggregate, result.metrics);
    if (result.realtimeStartup) realtimeStartup.push(result.realtimeStartup);
    for (const [kind, count] of Object.entries(result.realtimeMessages)) messages[kind] += count;
  }
  results[playerCount] = {
    metrics: Object.fromEntries(Object.entries(aggregate).map(([operation, metrics]) => [operation, summarizeMetrics(metrics)])),
    realtimeStartup,
    realtimeMessages: { ...messages, total: Object.values(messages).reduce((sum, count) => sum + count, 0) }
  };
}

console.log(JSON.stringify({
  mode,
  delivery,
  playerCounts,
  questionCount,
  runCount,
  realtimeConnectionPolicy: delivery === "realtime" ? {
    batchSize: realtimeConnectBatchSize,
    staggerMs: realtimeConnectStaggerMs,
    presenceBatchSize: realtimePresenceBatchSize,
    presenceStaggerMs: realtimePresenceStaggerMs,
    rationale: "Bound channel joins and pace Presence fan-out separately; gameplay latency timing starts after both readiness phases."
  } : null,
  percentilePolicy: "p50 for all non-empty samples; p95 at 20+ samples; p99 at 100+ samples",
  environment: {
    kind: "isolated-staging",
    targetOrigin: new URL(baseUrl).origin,
    vercelRegion: targetIdentity.vercelRegion,
    observedVercelRegions: [...observedVercelRegions].sort(),
    supabaseRegion: targetIdentity.supabaseRegion,
    dataPolicy: "Disposable quizzes, rooms, and players are ended and deleted after each run. This is simulated-client data, not physical-device data."
  },
  networkRequestCounts: Object.fromEntries([...networkRequestCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
  results
}, null, 2));
