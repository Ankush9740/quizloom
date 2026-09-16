import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { createSessionToken, hashToken } from "@/lib/server/session";
import { canAccessQuiz } from "@/lib/server/quiz-access";
import { apiError } from "@/lib/server/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getAdminClient();
  try {
    const id = z.string().uuid().parse((await params).id);
    if (!await canAccessQuiz(db, id, request.headers.get("x-quiz-token"))) return NextResponse.json({ error: "Quiz access is not valid on this device" }, { status: 403 });
    const { count: questionCount, error: countError } = await db.from("questions").select("id", { count: "exact", head: true }).eq("quiz_id", id);
    if (countError) throw countError; if (!questionCount) return NextResponse.json({ error: "This quiz has no questions" }, { status: 409 });
    const hostToken = createSessionToken();
    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 30 && !room; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const { count, error: lookupError } = await db.from("game_rooms").select("id", { head: true, count: "exact" }).eq("code", code);
      if (lookupError) throw lookupError;
      if (count) continue;
      const { data, error } = await db.from("game_rooms").insert({ quiz_id: id, code, status: "lobby", current_question: 0, expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() }).select("id,code").single();
      if (error?.code === "23505") continue;
      if (error) throw error;
      room = data;
    }
    if (!room) throw new Error("Could not allocate a unique room code. Please try again.");
    const { error: secretError } = await db.from("room_secrets").insert({ room_id: room.id, host_token_hash: hashToken(hostToken) });
    if (secretError) { await db.from("game_rooms").delete().eq("id", room.id); throw secretError; }
    return NextResponse.json({ roomId: room.id, code: room.code, hostToken }, { status: 201 });
  } catch (error) { return apiError(error); }
}
