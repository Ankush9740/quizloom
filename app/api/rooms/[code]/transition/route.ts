import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { roomCodeSchema } from "@/lib/validation";
import { toSafeCount } from "@/lib/runtime-normalization";

export const dynamic = "force-dynamic";

type TransitionResult =
  | { kind: "ok"; room: { status: "question"; currentQuestion: number; questionStartedAt: string | null; questionEndsAt: string | null; answerCount: number }; question: { id: string; number: number; prompt: string; timeLimit: number; options: { id: string; text: string; position: number }[] } }
  | { kind: "missing" }
  | { kind: "moved"; status: string }
  | { kind: "question-missing" };

// A transition fans out to every player at once. Coalesce only overlapping reads
// on this server instance; resolved values are never retained, so stale states
// cannot be replayed after the room advances.
const inFlightTransitions = new Map<string, Promise<TransitionResult>>();

function loadTransition(code: string, expectedQuestion: number) {
  const key = `${code}:${expectedQuestion}`;
  const existing = inFlightTransitions.get(key);
  if (existing) return existing;
  const pending = (async (): Promise<TransitionResult> => {
    const db = getAdminClient();
    const { data: room, error: roomError } = await db.from("game_rooms")
      .select("id,status,current_question,question_started_at,question_ends_at,answer_count,quiz_id")
      .eq("code", code).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (roomError && roomError.code !== "PGRST116") throw roomError;
    if (!room) return { kind: "missing" };
    if (room.status !== "question" || room.current_question !== expectedQuestion) return { kind: "moved", status: room.status };
    const { data: question, error: questionError } = await db.from("questions")
      .select("id,prompt,position,time_limit_seconds,question_options(id,text,position)")
      .eq("quiz_id", room.quiz_id).eq("position", room.current_question).maybeSingle();
    if (questionError) throw questionError;
    if (!question) return { kind: "question-missing" };
    const options = [...(question.question_options ?? [])].sort((a, b) => a.position - b.position);
    return {
      kind: "ok",
      room: {
        status: "question",
        currentQuestion: room.current_question,
        questionStartedAt: room.question_started_at,
        questionEndsAt: room.question_ends_at,
        answerCount: toSafeCount(room.answer_count)
      },
      question: {
        id: question.id,
        number: question.position + 1,
        prompt: question.prompt,
        timeLimit: question.time_limit_seconds,
        options: options.map(option => ({ id: option.id, text: option.text, position: option.position }))
      }
    };
  })();
  inFlightTransitions.set(key, pending);
  const clear = () => { if (inFlightTransitions.get(key) === pending) inFlightTransitions.delete(key); };
  void pending.then(clear, clear);
  return pending;
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const serverReceivedAt = new Date().toISOString();
  try {
    const code = roomCodeSchema.parse((await params).code);
    const expectedQuestion = Number(new URL(request.url).searchParams.get("question"));
    if (!Number.isInteger(expectedQuestion) || expectedQuestion < 0) {
      return NextResponse.json({ error: "Question number is not valid" }, { status: 400 });
    }
    const transition = await loadTransition(code, expectedQuestion);
    if (transition.kind === "missing") return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (transition.kind === "moved") return NextResponse.json({ error: "The room has already moved to another state", status: transition.status }, { status: 409 });
    if (transition.kind === "question-missing") return NextResponse.json({ error: "Current question not found" }, { status: 404 });
    return NextResponse.json({
      room: transition.room,
      question: transition.question,
      clock: { receivedAt: serverReceivedAt, sentAt: new Date().toISOString() }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
