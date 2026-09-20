import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError, assertDatabaseResult } from "@/lib/server/http";
import { safeEqualHash } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { normalizePlayerView } from "@/lib/runtime-normalization";
import { comparePlayerRank } from "@/lib/player-ranking";
import { QUESTION_START_LEAD_MS } from "@/lib/quiz-timing";

const schema = z.object({ code: roomCodeSchema, action: z.enum(["start", "reveal", "next", "end"]) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const db = getAdminClient();
    const { data: room, error: roomError } = await db.from("game_rooms")
      .select("id,quiz_id,status,current_question,question_started_at,question_ends_at,answer_count,speed_ranking_enabled,room_secrets(host_token_hash)")
      .eq("code", body.code).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (roomError && roomError.code !== "PGRST116") throw roomError;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const relatedSecret = Array.isArray(room.room_secrets) ? room.room_secrets[0] : room.room_secrets;
    if (!relatedSecret || !safeEqualHash(request.headers.get("x-host-token"), relatedSecret.host_token_hash)) {
      return NextResponse.json({ error: "Host access is no longer valid" }, { status: 403 });
    }

    const alreadyEnded = room.status === "finished" && room.current_question === -1;
    if (body.action === "end") {
      if (!alreadyEnded) {
        const now = new Date().toISOString();
        const ended = await db.from("game_rooms").update({ status: "finished", current_question: -1, question_ends_at: now, updated_at: now })
          .eq("id", room.id).select("id,status,current_question").single();
        assertDatabaseResult(ended);
      }
      return NextResponse.json({ ok: true, status: "ended", alreadyEnded });
    }
    if (alreadyEnded || room.status === "finished") return NextResponse.json({ error: "This room has ended" }, { status: 409 });

    if (body.action === "reveal") {
      if (room.status !== "question") return NextResponse.json({ error: "There is no active question" }, { status: 409 });
      const { data: reveal, error: revealError } = await db.rpc("reveal_quiz_answer", { p_room_id: room.id }).single();
      if (revealError) throw revealError;
      // The RPC has committed every score before it returns. Include those
      // authoritative standings in the same host response instead of relying
      // on a separately delivered Realtime player event.
      const { data: playerRows, error: playersError } = await db.from("players")
        .select("id,nickname,avatar_config,score,correct_answers,streak,correct_response_time_ms")
        .eq("room_id", room.id);
      if (playersError) throw playersError;
      const players = (playerRows ?? []).map(player => {
        const normalized = normalizePlayerView(player);
        return { ...normalized, speedRankingEnabled: room.speed_ranking_enabled, correctResponseTimeMs: room.speed_ranking_enabled && normalized.correctAnswers > 0 ? normalized.correctResponseTimeMs : null };
      }).sort(comparePlayerRank);
      return NextResponse.json({ ok: true, status: "results", correctOptionId: (reveal as { correct_option_id: string }).correct_option_id, players });
    }

    if (body.action === "start" && room.status !== "lobby") return NextResponse.json({ error: "The quiz has already started" }, { status: 409 });
    if (body.action === "next" && room.status !== "results") return NextResponse.json({ error: "Reveal the answer before continuing" }, { status: 409 });
    const { data: transition, error: transitionError } = await db.rpc("transition_quiz_room", {
      p_room_id: room.id,
      p_action: body.action,
      p_start_lead_ms: QUESTION_START_LEAD_MS
    });
    if (transitionError) throw transitionError;
    if (!transition) throw new Error("The room transition did not complete");
    return NextResponse.json({ ok: true, transition });
  } catch (error) { return apiError(error); }
}
