import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError, assertDatabaseResult } from "@/lib/server/http";
import { safeEqualHash } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { normalizePlayerView } from "@/lib/runtime-normalization";
import { comparePlayerRank } from "@/lib/player-ranking";
import { QUESTION_START_LEAD_MS } from "@/lib/quiz-timing";
import { startServerTrace } from "@/lib/server/performance";

const schema = z.object({ code: roomCodeSchema, action: z.enum(["start", "reveal", "next", "end"]) });

export async function POST(request: Request) {
  const trace = startServerTrace(request, "host.action");
  try {
    const body = schema.parse(await request.json());
    const db = getAdminClient();
    const { data: room, error: roomError } = await db.from("game_rooms")
      .select("id,quiz_id,status,current_question,question_started_at,question_ends_at,answer_count,speed_ranking_enabled,room_secrets(host_token_hash)")
      .eq("code", body.code).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (roomError && roomError.code !== "PGRST116") throw roomError;
    trace.mark("load-room-auth");
    if (!room) return trace.response(NextResponse.json({ error: "Room not found" }, { status: 404 }));
    const relatedSecret = Array.isArray(room.room_secrets) ? room.room_secrets[0] : room.room_secrets;
    if (!relatedSecret || !safeEqualHash(request.headers.get("x-host-token"), relatedSecret.host_token_hash)) {
      return trace.response(NextResponse.json({ error: "Host access is no longer valid" }, { status: 403 }));
    }

    const alreadyEnded = room.status === "finished" && room.current_question === -1;
    if (body.action === "end") {
      if (!alreadyEnded) {
        const now = new Date().toISOString();
        const ended = await db.from("game_rooms").update({ status: "finished", current_question: -1, question_ends_at: now, updated_at: now })
          .eq("id", room.id).select("id,status,current_question").single();
        assertDatabaseResult(ended);
        trace.mark("end-room");
      }
      return trace.response(NextResponse.json({ ok: true, status: "ended", alreadyEnded }));
    }
    if (alreadyEnded || room.status === "finished") return trace.response(NextResponse.json({ error: "This room has ended" }, { status: 409 }));

    if (body.action === "reveal") {
      if (room.status !== "question") return trace.response(NextResponse.json({ error: "There is no active question" }, { status: 409 }));
      const { data: reveal, error: revealError } = await db.rpc("reveal_quiz_answer_with_standings", { p_room_id: room.id });
      trace.mark("reveal-rpc");
      if (revealError) throw revealError;
      const authoritative = reveal as { correctOptionId?: string; players?: Record<string, unknown>[] } | null;
      if (!authoritative?.correctOptionId) throw new Error("The answer reveal did not complete");
      const players = (authoritative.players ?? []).map(player => {
        const normalized = normalizePlayerView(player);
        return { ...normalized, speedRankingEnabled: room.speed_ranking_enabled, correctResponseTimeMs: room.speed_ranking_enabled && normalized.correctAnswers > 0 ? normalized.correctResponseTimeMs : null };
      }).sort(comparePlayerRank);
      return trace.response(NextResponse.json({ ok: true, status: "results", correctOptionId: authoritative.correctOptionId, players }));
    }

    if (body.action === "start" && room.status !== "lobby") return trace.response(NextResponse.json({ error: "The quiz has already started" }, { status: 409 }));
    if (body.action === "next" && room.status !== "results") return trace.response(NextResponse.json({ error: "Reveal the answer before continuing" }, { status: 409 }));
    const { data: transition, error: transitionError } = await db.rpc("transition_quiz_room", {
      p_room_id: room.id,
      p_action: body.action,
      p_start_lead_ms: QUESTION_START_LEAD_MS
    });
    trace.mark("transition-rpc");
    if (transitionError) throw transitionError;
    if (!transition) throw new Error("The room transition did not complete");
    return trace.response(NextResponse.json({ ok: true, transition }));
  } catch (error) { return trace.response(apiError(error)); }
}
