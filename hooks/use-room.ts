"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomState, RoomTransition } from "@/lib/types";
import { applyAcceptedAnswer, applyHostRevealState, applyPlayerReveal, applyQuestionTransition, type PlayerReveal } from "@/lib/room-client-state";
import { normalizePlayerView, toSafeCount } from "@/lib/runtime-normalization";
import { currentServerTime, estimateServerClock, type ServerClock } from "@/lib/server-clock";
import { getBrowserClient } from "@/lib/supabase/client";
import { comparePlayerRank } from "@/lib/player-ranking";
import { recordClientDuration, startClientTrace } from "@/lib/client/performance";
import { mergeAnswerCounterBuckets } from "@/lib/answer-counter";

type Session = { playerId: string; playerToken: string } | null;
export function useRoom(code: string, session: Session = null, hostToken: string | null = null) {
  const [state, setState] = useState<RoomState | null>(null); const [error, setError] = useState(""); const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState<ServerClock | null>(null); const refreshSequence = useRef(0);
  const playerId = session?.playerId; const playerToken = session?.playerToken;
  const stateRef = useRef<RoomState | null>(null);
  const clockRef = useRef<ServerClock | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { clockRef.current = clock; }, [clock]);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current; const clientSentWallMs = Date.now();
    try {
      const query = playerId ? `?playerId=${playerId}` : "";
      const headers: Record<string, string> = {};
      if (playerToken) headers["x-player-token"] = playerToken;
      else if (hostToken) headers["x-host-token"] = hostToken;
      const response = await fetch(`/api/rooms/${code}/state${query}`, { cache: "no-store", headers });
      const json = await response.json() as RoomState & { error?: string }; const clientReceivedWallMs = Date.now(); const clientReceivedMonotonicMs = performance.now(); if (!response.ok) throw new Error(json.error);
      if (sequence !== refreshSequence.current) return;
      const nextClock = estimateServerClock(json.clock, clientSentWallMs, clientReceivedWallMs, clientReceivedMonotonicMs);
      clockRef.current = nextClock; setClock(nextClock);
      setState(previous => {
        let next = json;
        if (hostToken && previous?.room.status === "question" && json.room.status === "question" && previous.room.currentQuestion === json.room.currentQuestion) {
          const merged = mergeAnswerCounterBuckets(previous.room.answerBuckets, json.room.answerBuckets);
          const legacyAnswerCount = Math.max(previous.room.legacyAnswerCount ?? 0, json.room.legacyAnswerCount ?? 0);
          next = { ...json, room: { ...json.room, answerBuckets: merged.buckets, legacyAnswerCount, answerCount: legacyAnswerCount + merged.total } };
        }
        stateRef.current = next;
        return next;
      });
      setError("");
    } catch (e) { if (sequence === refreshSequence.current) setError(e instanceof Error ? e.message : "Could not refresh the room"); }
  }, [code, hostToken, playerId, playerToken]);

  const applyReveal = useCallback(async () => {
    if (!playerId || !playerToken) return refresh();
    try {
      const trace = startClientTrace("reveal.hydrate");
      const response = await fetch(`/api/rooms/${code}/reveal?playerId=${playerId}`, { cache: "no-store", headers: { "x-player-token": playerToken, ...trace.header } });
      trace.finish(response);
      const reveal = await response.json() as PlayerReveal & { error?: string }; if (!response.ok) throw new Error(reveal.error);
      // Invalidate an older full refresh so it cannot overwrite this newer,
      // authoritative reveal response with the preceding question state.
      refreshSequence.current += 1;
      setState(previous => {
        const next = previous ? applyPlayerReveal(previous, playerId, reveal) : previous;
        stateRef.current = next; return next;
      });
    } catch { await refresh(); }
  }, [code, playerId, playerToken, refresh]);

  const applyHostReveal = useCallback((correctOptionId: string, players: RoomState["players"]) => {
    // A visibility/online refresh started before reveal must not be allowed to
    // replace these post-transaction standings with pre-reveal scores.
    refreshSequence.current += 1;
    setState(previous => {
      const next = previous ? applyHostRevealState(previous, correctOptionId, players) : previous;
      stateRef.current = next; return next;
    });
  }, []);

  const applyRoomTransition = useCallback((transition: RoomTransition, expectedQuestion?: number) => {
    setState(previous => {
      if (!previous) return previous;
      if (expectedQuestion !== undefined && (
        previous.room.currentQuestion > expectedQuestion ||
        (previous.room.currentQuestion === expectedQuestion && ["results", "finished", "ended"].includes(previous.room.status))
      )) return previous;
      const next = applyQuestionTransition(previous, transition, expectedQuestion, playerId);
      stateRef.current = next;
      return next;
    });
  }, [playerId]);

  const markAnswered = useCallback((optionId: string, expectedQuestionId: string) => {
    setState(previous => {
      const next = previous && playerId ? applyAcceptedAnswer(previous, playerId, optionId, expectedQuestionId) : previous;
      stateRef.current = next; return next;
    });
  }, [playerId]);

  useEffect(() => { setState(null); setError(""); }, [code, playerId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const resynchronize = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", resynchronize); window.addEventListener("online", resynchronize);
    return () => { document.removeEventListener("visibilitychange", resynchronize); window.removeEventListener("online", resynchronize); };
  }, [refresh]);
  useEffect(() => {
    const db = getBrowserClient(); const roomId = state?.room.id; if (!db || !roomId) return;
    const pendingPlayers = new Map<string, Record<string, unknown>>();
    let frame: number | null = null;
    const flushPlayers = () => {
      frame = null;
      if (!pendingPlayers.size) return;
      const updates = new Map(pendingPlayers); pendingPlayers.clear();
      setState(previous => {
        if (!previous) return previous;
        let changed = false;
        const nextPlayers = previous.players.map(player => {
          const row = updates.get(player.id); if (!row) return player;
          updates.delete(player.id); changed = true;
          return normalizePlayerView({ ...player, ...row, id: player.id }, player);
        });
        for (const [id, row] of updates) {
          if (typeof row.nickname !== "string" || !row.nickname.trim() || !row.avatar_config) continue;
          changed = true; nextPlayers.push(normalizePlayerView({ ...row, id }));
        }
        return changed ? { ...previous, players: nextPlayers.sort(comparePlayerRank) } : previous;
      });
    };
    const handleRoomUpdate = (payload: { new: Record<string, unknown> }) => {
      const next = payload.new as { status?: RoomState["room"]["status"]; current_question?: number; answer_count?: number; question_started_at?: string | null; question_ends_at?: string | null; updated_at?: string };
      const updatedAtMs = new Date(next.updated_at ?? 0).getTime();
      if (Number.isFinite(updatedAtMs) && clockRef.current) {
        const receivedAtMs = currentServerTime(clockRef.current, performance.now(), Date.now());
        recordClientDuration("realtime.room-delivery", Math.max(0, receivedAtMs - updatedAtMs), { status: next.status ?? "unknown" });
      }
      if (next.status === "results") { if (playerId) void applyReveal(); return; }
      const current = stateRef.current;
      if (next.status === "question" && next.current_question === current?.room.currentQuestion && current?.room.status === "question") {
        setState(previous => {
          if (!previous) return previous;
          const legacyAnswerCount = Math.max(previous.room.legacyAnswerCount ?? 0, toSafeCount(next.answer_count));
          const bucketedAnswerCount = (previous.room.answerBuckets ?? []).reduce((sum, bucket) => sum + bucket.count, 0);
          const answerCount = legacyAnswerCount + bucketedAnswerCount;
          if (answerCount === previous.room.answerCount && legacyAnswerCount === previous.room.legacyAnswerCount) return previous;
          const updated = { ...previous, room: { ...previous.room, legacyAnswerCount, answerCount } };
          stateRef.current = updated;
          return updated;
        });
        return;
      }
      if (next.status === "question" && Number.isInteger(next.current_question)) {
        const expectedQuestion = next.current_question as number;
        void (async () => {
          const clientSentWallMs = Date.now();
          try {
            const trace = startClientTrace("question.hydrate");
            const response = await fetch(`/api/rooms/${code}/transition?question=${expectedQuestion}`, { cache: "no-store", headers: trace.header });
            trace.finish(response);
            const transition = await response.json() as RoomTransition & { error?: string };
            const clientReceivedWallMs = Date.now(); const clientReceivedMonotonicMs = performance.now();
            if (!response.ok) { if (response.status === 409) return void refresh(); throw new Error(transition.error); }
            if (transition.clock) { const nextClock = estimateServerClock(transition.clock, clientSentWallMs, clientReceivedWallMs, clientReceivedMonotonicMs); clockRef.current = nextClock; setClock(nextClock); }
            applyRoomTransition(transition, expectedQuestion);
            setError("");
          } catch { void refresh(); }
        })();
        return;
      }
      void refresh();
    };
    const channel = db.channel(`updates:${roomId}`, {
      // Do not consider the channel live until its Postgres Changes listener
      // can stream. This prevents a transition from falling into the gap
      // between the channel join and replication readiness.
      config: { postgres_changes_options: { wait: true } }
    })
      .on("system", {}, payload => {
        // Supabase reports rate-limit, replication, and authorization failures
        // as channel system errors. Reconcile immediately instead of waiting
        // for a visibility change while the client reconnects.
        if ((payload as { status?: string }).status === "error") void refresh();
      });
    if (playerId) {
      // Phase transitions and answer counts share one row. Non-overlapping
      // filters keep start/reveal/finish signals while excluding question-phase
      // answer_count updates that player screens never render.
      channel.on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "game_rooms",
        filter: `id=eq.${roomId},status=eq.question,answer_count=eq.0`
      }, handleRoomUpdate).on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "game_rooms",
        filter: `id=eq.${roomId},status=in.(results,finished)`
      }, handleRoomUpdate);
    } else {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, handleRoomUpdate);
      channel.on("postgres_changes", {
        event: "*", schema: "public", table: "room_answer_counters", filter: `room_id=eq.${roomId}`
      }, payload => {
        const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as { question_index?: number; bucket?: number; answer_count?: number };
        if (!Number.isInteger(row.question_index) || !Number.isInteger(row.bucket) || !Number.isInteger(row.answer_count)) return;
        setState(previous => {
          if (!previous || previous.room.status !== "question" || previous.room.currentQuestion !== row.question_index) return previous;
          const merged = mergeAnswerCounterBuckets(previous.room.answerBuckets, [{ bucket: row.bucket as number, count: row.answer_count as number }]);
          const answerCount = (previous.room.legacyAnswerCount ?? 0) + merged.total;
          if (answerCount === previous.room.answerCount && merged.buckets.length === previous.room.answerBuckets?.length) return previous;
          const next = { ...previous, room: { ...previous.room, answerBuckets: merged.buckets, answerCount } };
          stateRef.current = next;
          return next;
        });
      });
    }
    channel.on("postgres_changes", {
        // Players only need later lobby joins. Reveal and final-state requests
        // hydrate authoritative scores, so receiving every score UPDATE on
        // every player device is redundant fan-out. Hosts still receive all.
        event: playerId ? "INSERT" : "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}`
      }, payload => {
        const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<string, unknown>; const id = String(row.id ?? ""); if (!id) return;
        if (payload.eventType === "DELETE") { setState(previous => previous ? ({ ...previous, players: previous.players.filter(player => player.id !== id) }) : previous); return; }
        const existing = stateRef.current?.players.some(player => player.id === id);
        if (payload.eventType === "UPDATE" && !existing) return;
        if (playerId && payload.eventType === "UPDATE" && stateRef.current?.room.status !== "finished") return;
        pendingPlayers.set(id, row);
        frame ??= window.requestAnimationFrame(flushPlayers);
      }).subscribe(status => {
        const isSubscribed = status === "SUBSCRIBED";
        setConnected(isSubscribed);
        // One authoritative refresh after initial readiness and every rejoin
        // recovers any transition that happened before or during disconnect.
        if (isSubscribed) void refresh();
      });
    return () => { if (frame !== null) window.cancelAnimationFrame(frame); void db.removeChannel(channel); };
  }, [state?.room.id, code, playerId, applyReveal, applyRoomTransition, refresh]);
  return { state, error, connected, clock, refresh, applyHostReveal, applyRoomTransition, markAnswered };
}

export function usePresence(code: string, identity: { role: "host" } | { role: "player"; playerId: string } | null) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set()); const [synced, setSynced] = useState(false); const [hostOnline, setHostOnline] = useState(false);
  const role = identity?.role; const playerId = identity && "playerId" in identity ? identity.playerId : undefined;
  useEffect(() => {
    const db = getBrowserClient(); if (!db || !role) return;
    const channel = db.channel(`presence:${code}`, { config: { presence: { key: role === "host" ? "host" : playerId! } } });
    channel.on("presence", { event: "sync" }, () => { const ids = new Set<string>(); let host = false; Object.values(channel.presenceState()).flat().forEach((item: unknown) => { const p = item as { role?: string; playerId?: string }; if (p.role === "player" && p.playerId) ids.add(p.playerId); if (p.role === "host") host = true; }); setOnlineIds(ids); setHostOnline(host); setSynced(true); }).subscribe(status => { if (status === "SUBSCRIBED") void channel.track(role === "host" ? { role } : { role, playerId }); });
    return () => { void channel.untrack(); void db.removeChannel(channel); };
  }, [code, role, playerId]);
  return { onlineIds, synced, hostOnline };
}
