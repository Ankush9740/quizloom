import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { safeEqualHash } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { normalizePlayerView, toSafeCount } from "@/lib/runtime-normalization";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const serverReceivedAt = new Date().toISOString();
  try {
    const code = roomCodeSchema.parse((await params).code);
    const db = getAdminClient();
    const { data: room, error } = await db.from("game_rooms")
      .select("id,code,status,current_question,question_started_at,question_ends_at,answer_count,quiz_id,quizzes(title)")
      .eq("code", code).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const playerId = new URL(request.url).searchParams.get("playerId");
    const hostToken = request.headers.get("x-host-token");
    const shouldLoadQuestion = room.status !== "lobby" && room.status !== "finished";
    // Keep an authenticated player's identity in the lobby response. The
    // lightweight question transition relies on it to build player-specific
    // answer state without another full room request.
    const shouldLoadPlayer = Boolean(playerId);
    const [playersResult, countResult, questionResult, roomSecretResult, playerResult, playerSecretResult] = await Promise.all([
      db.from("players").select("id,nickname,avatar_config,score,correct_answers,streak,joined_at").eq("room_id", room.id).order("joined_at"),
      db.from("questions").select("id", { count: "exact", head: true }).eq("quiz_id", room.quiz_id),
      shouldLoadQuestion
        ? db.from("questions").select("id,prompt,position,time_limit_seconds,question_options(id,text,position,is_correct)").eq("quiz_id", room.quiz_id).eq("position", room.current_question).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      hostToken
        ? db.from("room_secrets").select("host_token_hash").eq("room_id", room.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      shouldLoadPlayer
        ? db.from("players").select("id,nickname,avatar_config,score,correct_answers,streak").eq("id", playerId).eq("room_id", room.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      shouldLoadPlayer
        ? db.from("player_secrets").select("player_token_hash").eq("player_id", playerId).maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);
    for (const result of [playersResult, countResult, questionResult, roomSecretResult, playerResult, playerSecretResult]) {
      if (result.error) throw result.error;
    }

    const quiz = Array.isArray(room.quizzes) ? room.quizzes[0] : room.quizzes;
    const publicStatus = room.status === "finished" && room.current_question === -1 ? "ended" : room.status;
    const hostAuthenticated = Boolean(roomSecretResult.data && safeEqualHash(hostToken, roomSecretResult.data.host_token_hash));
    const standingsVisible = publicStatus === "finished" || hostAuthenticated;
    const playerViews = (playersResult.data ?? []).map(player => {
      const view = normalizePlayerView(player);
      return standingsVisible ? view : { ...view, score: 0, correctAnswers: 0, streak: 0 };
    });
    if (standingsVisible) playerViews.sort((a, b) => b.score - a.score || b.correctAnswers - a.correctAnswers || a.nickname.localeCompare(b.nickname) || a.id.localeCompare(b.id));

    const response: Record<string, unknown> = {
      room: {
        id: room.id,
        code,
        title: (quiz as { title: string } | null)?.title ?? "Live quiz",
        status: publicStatus,
        currentQuestion: room.current_question,
        questionCount: toSafeCount(countResult.count),
        questionStartedAt: room.question_started_at,
        questionEndsAt: room.question_ends_at,
        answerCount: toSafeCount(room.answer_count)
      },
      players: playerViews
    };

    const player = playerResult.data;
    const secret = playerSecretResult.data;
    const playerAuthenticated = Boolean(player && secret && safeEqualHash(request.headers.get("x-player-token"), secret.player_token_hash));
    if (playerAuthenticated && player) {
      response.me = { ...normalizePlayerView(player), answered: false, lastPoints: 0 };
    }

    const current = questionResult.data;
    if (current) {
      const options = [...(current.question_options ?? [])].sort((a, b) => a.position - b.position);
      response.question = {
        id: current.id,
        number: current.position + 1,
        prompt: current.prompt,
        timeLimit: current.time_limit_seconds,
        options: options.map(option => ({ id: option.id, text: option.text, position: option.position })),
        ...(room.status === "results" ? { correctOptionId: options.find(option => option.is_correct)?.id } : {})
      };

      if (playerAuthenticated && player) {
        const { data: answer, error: answerError } = await db.from("answers")
          .select("selected_option_id,points_awarded,is_correct")
          .eq("player_id", player.id).eq("question_id", current.id).maybeSingle();
        if (answerError) throw answerError;
        response.me = {
          ...normalizePlayerView(player),
          answered: Boolean(answer),
          lastPoints: toSafeCount(answer?.points_awarded),
          ...(room.status === "results" && answer ? { selectedOptionId: answer.selected_option_id, wasCorrect: answer.is_correct } : {})
        };
      }
    }

    response.clock = { receivedAt: serverReceivedAt, sentAt: new Date().toISOString() };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
