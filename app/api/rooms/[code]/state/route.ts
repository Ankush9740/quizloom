import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { safeEqualHash } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = roomCodeSchema.parse((await params).code); const db = getAdminClient();
    const { data: room, error } = await db.from("game_rooms").select("id,code,status,current_question,question_started_at,question_ends_at,answer_count,quiz_id,quizzes(title)").eq("code", code).single();
    if (error && error.code !== "PGRST116") throw error;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const [{ data: players }, { data: questions, count }] = await Promise.all([
      db.from("players").select("id,nickname,avatar_config,score,correct_answers,streak").eq("room_id", room.id).order("score", { ascending: false }).order("joined_at"),
      db.from("questions").select("id,prompt,position,time_limit_seconds", { count: "exact" }).eq("quiz_id", room.quiz_id).order("position")
    ]);
    const quiz = Array.isArray(room.quizzes) ? room.quizzes[0] : room.quizzes;
    const response: Record<string, unknown> = { room: { id: room.id, code, title: (quiz as { title: string } | null)?.title ?? "Live quiz", status: room.status, currentQuestion: room.current_question, questionCount: count ?? 0, questionStartedAt: room.question_started_at, questionEndsAt: room.question_ends_at, answerCount: room.answer_count }, players: (players ?? []).map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar_config, score: p.score, correctAnswers: p.correct_answers, streak: p.streak })) };
    const current = questions?.find(q => q.position === room.current_question);
    if (current && room.status !== "lobby" && room.status !== "finished") {
      const { data: options } = await db.from("question_options").select("id,text,position,is_correct").eq("question_id", current.id).order("position");
      response.question = { id: current.id, number: current.position + 1, prompt: current.prompt, timeLimit: current.time_limit_seconds, options: (options ?? []).map(o => ({ id: o.id, text: o.text, position: o.position })), ...(room.status === "results" ? { correctOptionId: options?.find(o => o.is_correct)?.id } : {}) };
      const playerId = new URL(request.url).searchParams.get("playerId"); const token = request.headers.get("x-player-token");
      if (playerId) {
        const [{ data: player }, { data: secret }] = await Promise.all([db.from("players").select("id,nickname,avatar_config,score,correct_answers,streak").eq("id", playerId).eq("room_id", room.id).single(), db.from("player_secrets").select("player_token_hash").eq("player_id", playerId).single()]);
        if (player && secret && safeEqualHash(token, secret.player_token_hash)) {
          const { data: answer } = await db.from("answers").select("selected_option_id,points_awarded,is_correct").eq("player_id", player.id).eq("question_id", current.id).maybeSingle();
          response.me = { id: player.id, nickname: player.nickname, avatar: player.avatar_config, score: player.score, correctAnswers: player.correct_answers, streak: player.streak, answered: Boolean(answer), lastPoints: answer?.points_awarded ?? 0, ...(room.status === "results" && answer ? { selectedOptionId: answer.selected_option_id, wasCorrect: answer.is_correct } : {}) };
        }
      }
    }
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
