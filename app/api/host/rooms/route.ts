import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { createSessionToken, hashToken } from "@/lib/server/session";
import { apiError } from "@/lib/server/http";
import { quizSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const db = getAdminClient();
  let quizId: string | undefined;
  try {
    const draft = quizSchema.parse(await request.json());
    const { data: quiz, error: quizError } = await db.from("quizzes").insert({ title: draft.title, points_per_correct: draft.pointsPerCorrectAnswer }).select("id").single();
    if (quizError) throw quizError; quizId = quiz.id;
    for (let index = 0; index < draft.questions.length; index++) {
      const q = draft.questions[index];
      const { data: question, error } = await db.from("questions").insert({ quiz_id: quiz.id, prompt: q.prompt, position: index, time_limit_seconds: q.timeLimit }).select("id").single();
      if (error) throw error;
      const { error: optionError } = await db.from("question_options").insert(q.options.map((text, position) => ({ question_id: question.id, text, position, is_correct: position === q.correctIndex })));
      if (optionError) throw optionError;
    }
    const hostToken = createSessionToken();
    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 30 && !room; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const { count, error: lookupError } = await db.from("game_rooms").select("id", { head: true, count: "exact" }).eq("code", code);
      if (lookupError) throw lookupError;
      if (count) continue;
      const { data, error } = await db.from("game_rooms").insert({ quiz_id: quiz.id, code, status: "lobby", current_question: 0, expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() }).select("id,code").single();
      if (error?.code === "23505") continue;
      if (error) throw error;
      room = data;
    }
    if (!room) throw new Error("Could not allocate a unique room code. Please try again.");
    const { error: secretError } = await db.from("room_secrets").insert({ room_id: room.id, host_token_hash: hashToken(hostToken) });
    if (secretError) throw secretError;
    return NextResponse.json({ roomId: room.id, code: room.code, hostToken }, { status: 201 });
  } catch (error) {
    if (quizId) await db.from("quizzes").delete().eq("id", quizId);
    return apiError(error);
  }
}
