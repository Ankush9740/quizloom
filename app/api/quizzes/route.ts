import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { createSessionToken, hashToken } from "@/lib/server/session";
import { apiError } from "@/lib/server/http";
import { portableQuizSchema } from "@/lib/validation";
import { insertQuestions } from "@/lib/server/quiz-write";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const db = getAdminClient(); let quizId: string | undefined;
  try {
    const document = portableQuizSchema.parse(await request.json());
    const quizToken = createSessionToken();
    const { data: quiz, error } = await db.from("quizzes").insert({ title: document.title, description: document.description, points_per_correct: document.pointsPerCorrectAnswer, updated_at: new Date().toISOString() }).select("id").single();
    if (error) throw error; quizId = quiz.id;
    const { error: secretError } = await db.from("quiz_secrets").insert({ quiz_id: quiz.id, quiz_token_hash: hashToken(quizToken) });
    if (secretError) throw secretError;
    await insertQuestions(db, quiz.id, document.questions);
    return NextResponse.json({ quizId: quiz.id, quizToken }, { status: 201 });
  } catch (error) {
    if (quizId) await db.from("quizzes").delete().eq("id", quizId);
    return apiError(error);
  }
}
