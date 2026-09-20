import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { roomCodeSchema } from "@/lib/validation";

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
    const { data, error } = await db.rpc("get_quiz_room_transition", { p_room_code: code, p_question_index: expectedQuestion });
    if (error) throw error;
    return data as TransitionResult;
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
