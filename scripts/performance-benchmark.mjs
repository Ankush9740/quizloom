import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.QUIZLOOM_TEST_URL ?? "http://127.0.0.1:3000";
const mode = process.argv.find(arg => arg.startsWith("--mode="))?.split("=")[1] ?? "legacy";
const delivery = process.argv.find(arg => arg.startsWith("--delivery="))?.split("=")[1] ?? "realtime";
const playerCounts = (process.argv.find(arg => arg.startsWith("--players="))?.split("=")[1] ?? "2,10,20").split(",").map(Number);
const questionCount = Number(process.argv.find(arg => arg.startsWith("--questions="))?.split("=")[1] ?? 6);
if (!['legacy', 'optimized'].includes(mode)) throw new Error("--mode must be legacy or optimized");
if (!['realtime', 'direct'].includes(delivery)) throw new Error("--delivery must be realtime or direct");

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) throw new Error("Public Supabase configuration is required");

const avatar = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, options = {}, expectedStatus) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`${path} returned ${contentType || "no content type"}`);
  const body = await response.json();
  const elapsedMs = performance.now() - startedAt;
  if (expectedStatus !== undefined ? response.status !== expectedStatus : !response.ok) {
    throw new Error(`${path} returned ${response.status}: ${body.error ?? "request failed"}`);
  }
  return { body, elapsedMs };
}

function summarize(values) {
  if (!values.length) return { samples: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95Ms: Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)])
  };
}

function makeMetrics() {
  return { actionHttp: [], realtimeAfterClick: [], realtimeAfterResponse: [], followupHydration: [], stateReadyAfterClick: [], scheduledStartHeadroom: [], authoritativeDuration: [] };
}

function summarizeMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([key, values]) => [key, summarize(values)]));
}

async function runPopulation(playerCount) {
  const quizDocument = {
    version: 1,
    title: `Performance ${playerCount} ${Date.now()}`,
    description: "Disposable latency benchmark",
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
  const metrics = { start: makeMetrics(), reveal: makeMetrics(), next: makeMetrics(), answerCounter: makeMetrics(), finish: makeMetrics() };
  try {
    quiz = (await request("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quizDocument) }, 201)).body;
    room = (await request(`/api/quizzes/${quiz.quizId}`, { method: "POST", headers: { "x-quiz-token": quiz.quizToken } }, 201)).body;
    const players = await Promise.all(Array.from({ length: playerCount }, async (_, index) => (await request("/api/players/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: room.code, nickname: `Perf${playerCount}P${index + 1}`, avatar })
    }, 201)).body));

    if (delivery === "realtime") {
      const hostClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      clients.push(hostClient);
      const hostChannel = hostClient.channel(`perf-host-${room.roomId}`).on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${room.roomId}`
      }, payload => activeTracker?.onHostEvent(payload.new));
      channels.push([hostClient, hostChannel]);

      for (let index = 0; index < playerCount; index++) {
        const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        clients.push(client);
        const channel = client.channel(`perf-player-${room.roomId}-${index}`).on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${room.roomId}`
        }, payload => activeTracker?.onPlayerEvent(index, payload.new));
        channels.push([client, channel]);
      }
      await Promise.all(channels.map(([, channel]) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 15000);
        channel.subscribe(status => {
          if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error(`Realtime subscription failed: ${status}`)); }
        });
      })));
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
        sample.actionHttp.push(actionResult.elapsedMs);
        await Promise.all(players.map(async player => {
          const hydrateStartedAt = performance.now();
          let hydrated;
          if (followup === "state" && (mode === "legacy" || kind === "finish")) hydrated = await stateFor(player);
          else if (followup === "state") hydrated = await request(`/api/rooms/${room.code}/transition?question=${Number(actionResult.body.transition?.room?.currentQuestion)}`);
          if (followup === "reveal") hydrated = await revealFor(player);
          const readyAt = performance.now();
          sample.followupHydration.push(readyAt - hydrateStartedAt);
          sample.stateReadyAfterClick.push(readyAt - clickAt);
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
      const timeout = setTimeout(() => rejectAll(new Error(`${kind} events timed out`)), 20000);
      activeTracker = {
        onHostEvent() {},
        async onPlayerEvent(index, row) {
          if (seen.has(index) || !predicate(row)) return;
          seen.add(index);
          const eventAt = performance.now();
          sample.realtimeAfterClick.push(eventAt - clickAt);
          try {
            const hydrateStartedAt = performance.now();
            let hydrated;
            if (followup === "state" && (mode === "legacy" || kind === "finish")) hydrated = await stateFor(players[index]);
            else if (followup === "state") hydrated = await request(`/api/rooms/${room.code}/transition?question=${Number(row.current_question)}`);
            if (followup === "reveal") await revealFor(players[index]);
            await Promise.resolve();
            const readyAt = performance.now();
            sample.followupHydration.push(readyAt - hydrateStartedAt);
            sample.stateReadyAfterClick.push(readyAt - clickAt);
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
      sample.actionHttp.push(actionResult.elapsedMs);
      await complete;
      activeTracker = null;
      return actionResult.body;
    }

    async function measureAnswerCounter(questionNumber, optionId) {
      const sample = metrics.answerCounter;
      const clickAt = performance.now();
      if (delivery === "direct") {
        const result = await request("/api/answers", { method: "POST", headers: { "Content-Type": "application/json", "x-player-token": players[0].playerToken }, body: JSON.stringify({ code: room.code, playerId: players[0].playerId, optionId }) });
        sample.actionHttp.push(result.elapsedMs);
        const hydrateStartedAt = performance.now();
        const state = await hostState();
        if (Number(state.body.room.answerCount) !== 1) throw new Error("Authoritative answer count did not update");
        const readyAt = performance.now();
        sample.followupHydration.push(readyAt - hydrateStartedAt);
        sample.stateReadyAfterClick.push(readyAt - clickAt);
        return;
      }
      let resolveEvent;
      let rejectEvent;
      const event = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
      const timeout = setTimeout(() => rejectEvent(new Error("answer counter event timed out")), 20000);
      activeTracker = {
        onPlayerEvent() {},
        onHostEvent(row) {
          if (Number(row.current_question) !== questionNumber || Number(row.answer_count) !== 1) return;
          const eventAt = performance.now();
          sample.realtimeAfterClick.push(eventAt - clickAt);
          sample.stateReadyAfterClick.push(eventAt - clickAt);
          clearTimeout(timeout);
          resolveEvent();
        }
      };
      const result = await request("/api/answers", { method: "POST", headers: { "Content-Type": "application/json", "x-player-token": players[0].playerToken }, body: JSON.stringify({ code: room.code, playerId: players[0].playerId, optionId }) });
      const responseAt = performance.now();
      sample.actionHttp.push(result.elapsedMs);
      await event;
      const eventAt = clickAt + sample.realtimeAfterClick.at(-1);
      sample.realtimeAfterResponse.push(Math.max(0, eventAt - responseAt));
      sample.followupHydration.push(0);
      activeTracker = null;
    }

    for (let question = 0; question < questionCount; question++) {
      const kind = question === 0 ? "start" : "next";
      await measureTransition(kind, kind, row => row.status === "question" && Number(row.current_question) === question, "state");
      const currentState = (await stateFor(players[0])).body;
      await sleep(Math.max(0, new Date(currentState.room.questionStartedAt).getTime() - Date.now()) + 100);
      await measureAnswerCounter(question, currentState.question.options[0].id);
      await measureTransition("reveal", "reveal", row => row.status === "results" && Number(row.current_question) === question, "reveal");
    }
    await measureTransition("finish", "next", row => row.status === "finished" && Number(row.current_question) === questionCount - 1, "state");
    await hostAction("end");
    return Object.fromEntries(Object.entries(metrics).map(([key, values]) => [key, summarizeMetrics(values)]));
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

const results = {};
for (const count of playerCounts) results[count] = await runPopulation(count);
console.log(JSON.stringify({ mode, delivery, playerCounts, questionCount, environment: delivery === "realtime" ? "local Next.js dev server with separate Supabase Realtime clients; not physical-device data" : "local Next.js dev server with parallel direct transition/reveal hydration requests; excludes Realtime delivery and physical-device network delay", results }, null, 2));
