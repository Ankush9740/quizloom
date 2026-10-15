import { createClient } from "@supabase/supabase-js";
import { loadStagingEnvironment } from "./lib/staging-environment.mjs";

const argv = process.argv.slice(2);
const staging = loadStagingEnvironment({ argv, requireWriteConfirmation: true });
const baseUrl = staging.baseUrl;
const mode = argv.find(argument => argument.startsWith("--mode="))?.split("=")[1] ?? "optimized";
const delivery = argv.find(argument => argument.startsWith("--delivery="))?.split("=")[1] ?? "realtime";
const playerCounts = (argv.find(argument => argument.startsWith("--players="))?.split("=")[1] ?? "2,10,20,50").split(",").map(Number);
const questionCount = Number(argv.find(argument => argument.startsWith("--questions="))?.split("=")[1] ?? 6);
const runCount = Number(argv.find(argument => argument.startsWith("--runs="))?.split("=")[1] ?? 3);

if (!["legacy", "optimized"].includes(mode)) throw new Error("--mode must be legacy or optimized");
if (!["realtime", "direct"].includes(delivery)) throw new Error("--delivery must be realtime or direct");
if (!playerCounts.length || playerCounts.some(count => !Number.isInteger(count) || count < 1 || count > 50)) throw new Error("--players must contain integers from 1 through 50");
if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 50) throw new Error("--questions must be an integer from 1 through 50");
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 20) throw new Error("--runs must be an integer from 1 through 20");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const avatar = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const networkRequestCounts = new Map();
const observedVercelRegions = new Set();

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
  const clients = [];
  const channels = [];
  const realtimeMessages = { hostRoom: 0, playerRoom: 0, hostPlayerRows: 0, playerPlayerRows: 0, presenceSyncs: 0 };
  const metrics = {
    quizCreate: makeMetrics(), roomCreate: makeMetrics(), join: makeMetrics(), start: makeMetrics(),
    answerSubmit: makeMetrics(), answerCounter: makeMetrics(), reveal: makeMetrics(), next: makeMetrics(),
    finish: makeMetrics(), finalStandings: makeMetrics()
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
      const hostClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      clients.push(hostClient);
      const hostChannel = hostClient.channel(`perf-host-${room.roomId}-${runNumber}`).on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${room.roomId}`
      }, payload => { realtimeMessages.hostRoom++; activeTracker?.onHostEvent(payload.new); }).on("postgres_changes", {
        event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.roomId}`
      }, () => { realtimeMessages.hostPlayerRows++; });
      channels.push([hostClient, hostChannel]);
      const hostPresence = hostClient.channel(`perf-presence-${room.roomId}-${runNumber}`, { config: { presence: { key: "host" } } })
        .on("presence", { event: "sync" }, () => { realtimeMessages.presenceSyncs++; });
      channels.push([hostClient, hostPresence, { role: "host" }]);

      for (let index = 0; index < playerCount; index++) {
        const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        clients.push(client);
        const channel = client.channel(`perf-player-${room.roomId}-${runNumber}-${index}`).on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${room.roomId}`
        }, payload => { realtimeMessages.playerRoom++; activeTracker?.onPlayerEvent(index, payload.new); }).on("postgres_changes", {
          event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.roomId}`
        }, () => { realtimeMessages.playerPlayerRows++; });
        channels.push([client, channel]);
        const presence = client.channel(`perf-presence-${room.roomId}-${runNumber}`, { config: { presence: { key: players[index].playerId } } })
          .on("presence", { event: "sync" }, () => { realtimeMessages.presenceSyncs++; });
        channels.push([client, presence, { role: "player", playerId: players[index].playerId }]);
      }
      await Promise.all(channels.map(([, channel]) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 20_000);
        channel.subscribe(status => {
          if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error(`Realtime subscription failed: ${status}`)); }
        });
      })));
      await Promise.all(channels.filter(([, , presence]) => presence).map(([, channel, presence]) => channel.track(presence)));
    }

    const stateFor = player => request(`/api/rooms/${room.code}/state?playerId=${player.playerId}`, { headers: { "x-player-token": player.playerToken } });
    const revealFor = player => request(`/api/rooms/${room.code}/reveal?playerId=${player.playerId}`, { headers: { "x-player-token": player.playerToken } });
    const hostAction = action => request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": room.hostToken }, body: JSON.stringify({ code: room.code, action }) });
    const hostState = () => request(`/api/rooms/${room.code}/state`, { headers: { "x-host-token": room.hostToken } });

    async function measureTransition(kind, action, predicate, followup) {
      const sample = metrics[kind];
      const clickAt = performance.now();
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
      let resolveAll;
      let rejectAll;
      const complete = new Promise((resolve, reject) => { resolveAll = resolve; rejectAll = reject; });
      const seen = new Set();
      let completed = 0;
      const timeout = setTimeout(() => rejectAll(new Error(`${kind} events timed out`)), 20_000);
      activeTracker = {
        onHostEvent() {},
        async onPlayerEvent(index, row) {
          if (seen.has(index) || !predicate(row)) return;
          seen.add(index);
          const eventAt = performance.now();
          sample.realtimeAfterClick.push(eventAt - clickAt);
          recordDatabaseDelivery(sample, row, Date.now());
          try {
            const hydrateStartedAt = performance.now();
            let hydrated;
            if (followup === "state" && (mode === "legacy" || kind === "finish")) hydrated = await stateFor(players[index]);
            else if (followup === "state") hydrated = await request(`/api/rooms/${room.code}/transition?question=${Number(row.current_question)}`);
            if (followup === "reveal") hydrated = await revealFor(players[index]);
            const readyAt = performance.now();
            sample.followupHydration.push(readyAt - hydrateStartedAt);
            sample.stateReadyAfterClick.push(readyAt - clickAt);
            if (hydrated) recordFollowupHttp(sample, hydrated);
            if ((kind === "start" || kind === "next") && hydrated?.body?.room?.questionStartedAt) {
              sample.scheduledStartHeadroom.push(new Date(hydrated.body.room.questionStartedAt).getTime() - Date.now());
              sample.authoritativeDuration.push(new Date(hydrated.body.room.questionEndsAt).getTime() - new Date(hydrated.body.room.questionStartedAt).getTime());
            }
            if (responseAt !== null) sample.realtimeAfterResponse.push(Math.max(0, eventAt - responseAt));
            completed++;
            if (completed === playerCount) { clearTimeout(timeout); resolveAll(); }
          } catch (error) { clearTimeout(timeout); rejectAll(error); }
        }
      };
      const actionResult = await hostAction(action);
      responseAt = performance.now();
      recordHttp(sample, actionResult);
      await complete;
      activeTracker = null;
      return actionResult.body;
    }

    async function measureAnswers(questionNumber, optionId) {
      const counterSample = metrics.answerCounter;
      const clickAt = performance.now();
      let waitForFinalCounter = Promise.resolve();

      if (delivery === "realtime") {
        let resolveEvent;
        let rejectEvent;
        waitForFinalCounter = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
        const seenCounts = new Set();
        const timeout = setTimeout(() => rejectEvent(new Error("answer counter event timed out")), 20_000);
        activeTracker = {
          onPlayerEvent() {},
          onHostEvent(row) {
            const count = Number(row.answer_count);
            if (Number(row.current_question) !== questionNumber || count < 1 || seenCounts.has(count)) return;
            seenCounts.add(count);
            const eventAt = performance.now();
            counterSample.realtimeAfterClick.push(eventAt - clickAt);
            counterSample.stateReadyAfterClick.push(eventAt - clickAt);
            recordDatabaseDelivery(counterSample, row, Date.now());
            if (count === playerCount) { clearTimeout(timeout); resolveEvent(); }
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
        await waitForFinalCounter;
        activeTracker = null;
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
    return { metrics, realtimeMessages };
  } finally {
    activeTracker = null;
    await Promise.allSettled(channels.map(([client, channel]) => client.removeChannel(channel)));
    await Promise.allSettled(clients.map(client => client.removeAllChannels()));
    for (const client of clients) client.realtime.disconnect();
    if (room) {
      try { await request("/api/host/action", { method: "POST", headers: { "Content-Type": "application/json", "x-host-token": room.hostToken }, body: JSON.stringify({ code: room.code, action: "end" }) }); } catch {}
    }
    if (quiz) {
      try { await request(`/api/quizzes/${quiz.quizId}`, { method: "DELETE", headers: { "x-quiz-token": quiz.quizToken } }); } catch {}
    }
    await sleep(100);
  }
}

const targetIdentity = await verifyStagingApplication();
const results = {};
for (const playerCount of playerCounts) {
  const aggregate = {};
  const messages = { hostRoom: 0, playerRoom: 0, hostPlayerRows: 0, playerPlayerRows: 0, presenceSyncs: 0 };
  for (let run = 1; run <= runCount; run++) {
    console.error(`Benchmarking ${playerCount} players, run ${run}/${runCount}...`);
    const result = await runPopulation(playerCount, run);
    mergeMetrics(aggregate, result.metrics);
    for (const [kind, count] of Object.entries(result.realtimeMessages)) messages[kind] += count;
  }
  results[playerCount] = {
    metrics: Object.fromEntries(Object.entries(aggregate).map(([operation, metrics]) => [operation, summarizeMetrics(metrics)])),
    realtimeMessages: { ...messages, total: Object.values(messages).reduce((sum, count) => sum + count, 0) }
  };
}

console.log(JSON.stringify({
  mode,
  delivery,
  playerCounts,
  questionCount,
  runCount,
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
