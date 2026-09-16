"use client";
import { useCallback, useEffect, useState } from "react";
import type { PlayerView, RoomState } from "@/lib/types";
import { normalizePlayerView, toSafeCount } from "@/lib/runtime-normalization";
import { getBrowserClient } from "@/lib/supabase/client";

type Session = { playerId: string; playerToken: string } | null;
export function useRoom(code: string, session: Session = null) {
  const [state, setState] = useState<RoomState | null>(null); const [error, setError] = useState(""); const [connected, setConnected] = useState(true);
  const playerId = session?.playerId; const playerToken = session?.playerToken;
  const refresh = useCallback(async () => {
    try {
      const query = playerId ? `?playerId=${playerId}` : "";
      const response = await fetch(`/api/rooms/${code}/state${query}`, { cache: "no-store", headers: playerToken ? { "x-player-token": playerToken } : {} });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      setState(json); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not refresh the room"); }
  }, [code, playerId, playerToken]);

  const applyReveal = useCallback(async () => {
    if (!playerId || !playerToken) return refresh();
    try {
      const response = await fetch(`/api/rooms/${code}/reveal?playerId=${playerId}`, { cache: "no-store", headers: { "x-player-token": playerToken } });
      const reveal = await response.json(); if (!response.ok) throw new Error(reveal.error);
      setState(previous => previous?.question && previous.me ? ({ ...previous, room: { ...previous.room, status: "results" }, question: { ...previous.question, correctOptionId: reveal.correctOptionId }, me: { ...previous.me, answered: reveal.answered, selectedOptionId: reveal.selectedOptionId ?? undefined, wasCorrect: reveal.wasCorrect ?? undefined, lastPoints: reveal.lastPoints, score: reveal.score, correctAnswers: reveal.correctAnswers, streak: reveal.streak } }) : previous);
    } catch { await refresh(); }
  }, [code, playerId, playerToken, refresh]);

  const applyHostReveal = useCallback((correctOptionId: string) => {
    setState(previous => previous?.question ? ({ ...previous, room: { ...previous.room, status: "results" }, question: { ...previous.question, correctOptionId } }) : previous);
  }, []);

  useEffect(() => { setState(null); setError(""); }, [code, playerId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const db = getBrowserClient(); const roomId = state?.room.id; if (!db || !roomId) return;
    const channel = db.channel(`updates:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, payload => {
        const next = payload.new as { status?: RoomState["room"]["status"]; current_question?: number; answer_count?: number };
        if (next.status === "results") { if (playerId) void applyReveal(); return; }
        if (next.status === "question" && next.current_question === state?.room.currentQuestion && state.room.status === "question") {
          setState(previous => previous ? ({ ...previous, room: { ...previous.room, answerCount: toSafeCount(next.answer_count, previous.room.answerCount) } }) : previous);
          return;
        }
        void refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, payload => {
        const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<string, unknown>; const id = String(row.id ?? ""); if (!id) return;
        if (payload.eventType === "DELETE") { setState(previous => previous ? ({ ...previous, players: previous.players.filter(player => player.id !== id) }) : previous); return; }
        setState(previous => { if (!previous) return previous; const existing = previous.players.find(player => player.id === id); const mapped: PlayerView = normalizePlayerView({ ...row, id }, existing); return { ...previous, players: [...previous.players.filter(player => player.id !== id), mapped].sort((a,b) => b.score - a.score) }; });
      })
      .subscribe(status => setConnected(status === "SUBSCRIBED"));
    return () => { void db.removeChannel(channel); };
  }, [state?.room.id, state?.room.status, state?.room.currentQuestion, playerId, applyReveal, refresh]);
  return { state, error, connected, refresh, applyHostReveal };
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
