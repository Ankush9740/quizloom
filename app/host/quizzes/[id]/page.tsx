import { QuizBuilder } from "@/components/quiz-builder";
export default async function EditQuizPage({ params }: { params: Promise<{ id: string }> }) { return <QuizBuilder quizId={(await params).id}/>; }
