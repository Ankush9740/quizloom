export type QuizAccess = { id: string; token: string };
const storageKey = "quizloom:quiz-library";

export function getQuizAccess(): QuizAccess[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(item => typeof item?.id === "string" && typeof item?.token === "string") : [];
  } catch { return []; }
}

export function getQuizToken(id: string) { return getQuizAccess().find(item => item.id === id)?.token ?? null; }
export function rememberQuiz(id: string, token: string) {
  const next = [{ id, token }, ...getQuizAccess().filter(item => item.id !== id)];
  localStorage.setItem(storageKey, JSON.stringify(next.slice(0, 100)));
}

export function forgetQuiz(id: string) {
  localStorage.setItem(storageKey, JSON.stringify(getQuizAccess().filter(item => item.id !== id)));
}
