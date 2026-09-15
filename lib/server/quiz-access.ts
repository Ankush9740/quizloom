import type { SupabaseClient } from "@supabase/supabase-js";
import { safeEqualHash } from "@/lib/server/session";

export async function canAccessQuiz(db: SupabaseClient, quizId: string, token: string | null) {
  if (!token) return false;
  const { data, error } = await db.from("quiz_secrets").select("quiz_token_hash").eq("quiz_id", quizId).maybeSingle();
  if (error) throw error;
  return Boolean(data && safeEqualHash(token, data.quiz_token_hash));
}

export function quizDocumentFromRows(quiz: {
  title: string; description: string | null; points_per_correct: number;
  questions: { prompt: string; position: number; time_limit_seconds: number; question_options: { text: string; position: number; is_correct: boolean }[] }[];
}) {
  return {
    version: 1 as const,
    title: quiz.title,
    description: quiz.description ?? "",
    pointsPerCorrectAnswer: quiz.points_per_correct,
    questions: [...quiz.questions].sort((a,b) => a.position - b.position).map(question => {
      const options = [...question.question_options].sort((a,b) => a.position - b.position);
      return { question: question.prompt, options: options.map(o => o.text), correctAnswer: options.findIndex(o => o.is_correct), timeLimit: question.time_limit_seconds };
    })
  };
}
