import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { hashToken } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { startServerTrace } from "@/lib/server/performance";

export const dynamic = "force-dynamic";

type TransitionResult =
  | { kind: "ok"; room: { status: "question"; currentQuestion: number; questionStartedAt: string | null; questionEndsAt: string | null; answerCount: number }; question: { id: string; number: number; prompt: string; timeLimit: number; options: { id: string; text: string; position: number }[] } }
  | { kind: "unauthorized" }
  | { kind: "moved"; status: string }
  | { kind: "question-missing" };

function transitionResponse(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  // The merged RPC performs exactly one database call per authenticated
  // hydration. Process-local coalescing is intentionally not part of
  // correctness because requests can land on different Vercel instances.
  response.headers.set("X-Quizloom-Transition-Coalescer", "disabled");
  response.headers.set("X-Quizloom-Database-Calls", "1");
  return response;
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
    const { data, error } = await db.rpc("get_authorized_quiz_room_transition", {
      p_room_code: code,
      p_question_index: expectedQuestion,
      p_host_token_hash: hostToken ? hashToken(hostToken) : null,
      p_player_id: playerId,
      p_player_token_hash: playerToken ? hashToken(playerToken) : null
    });
    if (error) throw error;
    trace.mark("authorized-transition-rpc");
    const transition = data as TransitionResult;
    if (transition.kind === "unauthorized") return trace.response(transitionResponse({ error: "Room access is no longer valid" }, 403));
    if (transition.kind === "moved") return trace.response(transitionResponse({ error: "The room has already moved to another state", status: transition.status }, 409));
    if (transition.kind === "question-missing") return trace.response(transitionResponse({ error: "Current question not found" }, 404));
    return trace.response(transitionResponse({
      room: transition.room,
      question: transition.question,
      clock: { receivedAt: serverReceivedAt, sentAt: new Date().toISOString() }
    }));
  } catch (error) { return trace.response(apiError(error)); }
}
