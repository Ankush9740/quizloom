import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/server/session";
import { apiError } from "@/lib/server/http";

const schema = z.object({ access: z.array(z.object({ id: z.string().uuid(), token: z.string().min(20).max(200) }).strict()).max(100) }).strict();

export async function POST(request: Request) {
  try {
    const { access } = schema.parse(await request.json());
    if (!access.length) return NextResponse.json({ quizzes: [] });
    const db = getAdminClient(); const ids = access.map(item => item.id);
    const [{ data: secrets, error: secretsError }, { data: quizzes, error: quizzesError }] = await Promise.all([
      db.from("quiz_secrets").select("quiz_id,quiz_token_hash").in("quiz_id", ids),
      db.from("quizzes").select("id,title,description,updated_at,questions(id)").in("id", ids).order("updated_at", { ascending: false })
    ]);
    if (secretsError) throw secretsError; if (quizzesError) throw quizzesError;
    const allowed = new Set((secrets ?? []).filter(secret => { const token = access.find(item => item.id === secret.quiz_id)?.token; return token && hashToken(token) === secret.quiz_token_hash; }).map(secret => secret.quiz_id));
    return NextResponse.json({ quizzes: (quizzes ?? []).filter(quiz => allowed.has(quiz.id)).map(quiz => ({ id: quiz.id, title: quiz.title, description: quiz.description ?? "", updatedAt: quiz.updated_at, questionCount: quiz.questions?.length ?? 0 })) });
  } catch (error) { return apiError(error); }
}
