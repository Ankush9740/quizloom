import { getAdminClient } from "@/lib/supabase/server";
import { portableQuizSchema } from "@/lib/validation";

export async function insertQuestions(db: ReturnType<typeof getAdminClient>, quizId: string, questions: ReturnType<typeof portableQuizSchema.parse>["questions"]) {
  const { data: insertedQuestions, error } = await db.from("questions").insert(questions.map((item, position) => ({
    quiz_id: quizId,
    prompt: item.question,
    position,
    time_limit_seconds: item.timeLimit
  }))).select("id,position");
  if (error) throw error;
  if (!insertedQuestions || insertedQuestions.length !== questions.length) throw new Error("Not every quiz question was saved");

  const questionIdByPosition = new Map(insertedQuestions.map(question => [question.position, question.id]));
  const options = questions.flatMap((item, position) => {
    const questionId = questionIdByPosition.get(position);
    if (!questionId) throw new Error("A saved question could not be matched to its answers");
    return item.options.map((text, optionPosition) => ({
      question_id: questionId,
      text,
      position: optionPosition,
      is_correct: optionPosition === item.correctAnswer
    }));
  });
  const { error: optionsError } = await db.from("question_options").insert(options);
  if (optionsError) throw optionsError;
}
