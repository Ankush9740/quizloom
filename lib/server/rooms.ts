import type { SupabaseClient } from "@supabase/supabase-js";
import { createSessionToken, hashToken } from "@/lib/server/session";

export async function createRoomForQuiz(db: SupabaseClient, quizId: string, mark?: (stage: string) => void) {
  const now = new Date().toISOString();
  const { error: expiryError } = await db.from("game_rooms").update({
    status: "finished",
    current_question: -1,
    question_ends_at: now,
    updated_at: now
  }).eq("quiz_id", quizId).in("status", ["lobby", "question", "results"]).lte("expires_at", now);
  if (expiryError) throw expiryError;
  mark?.("normalize-expired");

  const { count: questionCount, error: countError } = await db.from("questions").select("id", { count: "exact", head: true }).eq("quiz_id", quizId);
  if (countError) throw countError;
  if (!questionCount) return { error: "This quiz has no questions" as const };
  mark?.("count-questions");

  const hostToken = createSessionToken();
  let room: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 30 && !room; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { count, error: lookupError } = await db.from("game_rooms").select("id", { head: true, count: "exact" }).eq("code", code);
    if (lookupError) throw lookupError;
    if (count) continue;
    const { data, error } = await db.from("game_rooms").insert({
      quiz_id: quizId,
      code,
      status: "lobby",
      current_question: 0,
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
    }).select("id,code").single();
    if (error?.code === "23505") continue;
    if (error) throw error;
    room = data;
  }
  if (!room) throw new Error("Could not allocate a unique room code. Please try again.");
  mark?.("allocate-room");

  const { error: secretError } = await db.from("room_secrets").insert({ room_id: room.id, host_token_hash: hashToken(hostToken) });
  if (secretError) {
    await db.from("game_rooms").delete().eq("id", room.id);
    throw secretError;
  }
  mark?.("store-secret");
  return { roomId: room.id, code: room.code, hostToken };
}
