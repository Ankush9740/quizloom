import type { SupabaseClient } from "@supabase/supabase-js";
import { createSessionToken, hashToken } from "@/lib/server/session";

export async function createRoomForQuiz(db: SupabaseClient, quizId: string, quizToken: string | null, mark?: (stage: string) => void) {
  if (!quizToken) return { error: "Quiz access is not valid on this device", status: 403 as const };
  const hostToken = createSessionToken();
  const { data, error } = await db.rpc("create_quiz_room", {
    p_quiz_id: quizId,
    p_quiz_token_hash: hashToken(quizToken),
    p_host_token_hash: hashToken(hostToken)
  });
  mark?.("room-rpc");
  if (error) throw error;
  const result = data as { kind?: string; roomId?: string; code?: string } | null;
  if (result?.kind === "forbidden") return { error: "Quiz access is not valid on this device", status: 403 as const };
  if (result?.kind === "no-questions") return { error: "This quiz has no questions", status: 409 as const };
  if (result?.kind === "code-exhausted") return { error: "Could not allocate a unique room code. Please try again.", status: 503 as const };
  if (result?.kind !== "ok" || !result.roomId || !result.code) throw new Error("The room was not created");
  return { roomId: result.roomId, code: result.code, hostToken };
}
