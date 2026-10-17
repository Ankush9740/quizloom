import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { hashToken } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { startServerTrace } from "@/lib/server/performance";

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
  const trace = startServerTrace(request, "question.hydrate");
  const serverReceivedAt = new Date().toISOString();
  try {
    const code = roomCodeSchema.parse((await params).code);
    const expectedQuestion = Number(new URL(request.url).searchParams.get("question"));
    if (!Number.isInteger(expectedQuestion) || expectedQuestion < 0) {
      return trace.response(NextResponse.json({ error: "Question number is not valid" }, { status: 400 }));
    }
    const playerIdValue = new URL(request.url).searchParams.get("playerId");
    const playerId = playerIdValue && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerIdValue) ? playerIdValue : null;
    const hostToken = request.headers.get("x-host-token");
    const playerToken = request.headers.get("x-player-token");
    const db = getAdminClient();
    const { data: authorized, error: authorizationError } = await db.rpc("authorize_quiz_room_session", {
      p_room_code: code,
      p_host_token_hash: hostToken ? hashToken(hostToken) : null,
      p_player_id: playerId,
      p_player_token_hash: playerToken ? hashToken(playerToken) : null
    });
    if (authorizationError) throw authorizationError;
    trace.mark("authorize-session");
    if (!authorized) return trace.response(NextResponse.json({ error: "Room access is no longer valid" }, { status: 403 }));
    const transition = await loadTransition(code, expectedQuestion);
    trace.mark("transition-rpc");
    if (transition.kind === "missing") return trace.response(NextResponse.json({ error: "Room not found" }, { status: 404 }));
    if (transition.kind === "moved") return trace.response(NextResponse.json({ error: "The room has already moved to another state", status: transition.status }, { status: 409 }));
    if (transition.kind === "question-missing") return trace.response(NextResponse.json({ error: "Current question not found" }, { status: 404 }));
    return trace.response(NextResponse.json({
      room: transition.room,
      question: transition.question,
      clock: { receivedAt: serverReceivedAt, sentAt: new Date().toISOString() }
    }, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) { return trace.response(apiError(error)); }
}
