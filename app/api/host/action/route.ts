import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError, assertDatabaseResult } from "@/lib/server/http";
import { safeEqualHash } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";

const schema = z.object({ code: roomCodeSchema, action: z.enum(["start", "reveal", "next", "end", "play_again"]) });
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json()); const db = getAdminClient();
    const { data: room, error: roomError } = await db.from("game_rooms").select("id,quiz_id,status,current_question").eq("code", body.code).single();
    if (roomError && roomError.code !== "PGRST116") throw roomError;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const { data: secret, error: secretError } = await db.from("room_secrets").select("host_token_hash").eq("room_id", room.id).single();
    if (secretError) throw secretError;
    if (!secret || !safeEqualHash(request.headers.get("x-host-token"), secret.host_token_hash)) return NextResponse.json({ error: "Host access is no longer valid" }, { status: 403 });
    const { data: questions, error: questionsError } = await db.from("questions").select("id,position,time_limit_seconds").eq("quiz_id", room.quiz_id).order("position");
    if (questionsError) throw questionsError;
    let result: Record<string, unknown> = { ok: true };
    if (body.action === "reveal") {
      if (room.status !== "question") return NextResponse.json({ error: "There is no active question" }, { status: 409 });
      const current = questions?.find(question => question.position === room.current_question);
      if (!current) return NextResponse.json({ error: "Current question not found" }, { status: 409 });
      const { data: reveal, error: revealError } = await db.rpc("reveal_quiz_answer", { p_room_id: room.id }).single();
      if (revealError) throw revealError;
      result = { ok: true, status: "results", correctOptionId: (reveal as { correct_option_id: string }).correct_option_id };
    } else if (body.action === "end") {
      assertDatabaseResult(await db.from("game_rooms").update({ status: "finished", question_ends_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", room.id));
    } else if (body.action === "play_again") {
      assertDatabaseResult(await db.from("answers").delete().eq("room_id", room.id));
      assertDatabaseResult(await db.from("players").update({ score: 0, correct_answers: 0, streak: 0 }).eq("room_id", room.id));
      assertDatabaseResult(await db.from("game_rooms").update({ status: "lobby", current_question: 0, question_started_at: null, question_ends_at: null, answer_count: 0, updated_at: new Date().toISOString() }).eq("id", room.id));
    } else {
      if (body.action === "start" && room.status !== "lobby") return NextResponse.json({ error: "The quiz has already started" }, { status: 409 });
      if (body.action === "next" && room.status !== "results") return NextResponse.json({ error: "Reveal the answer before continuing" }, { status: 409 });
      const index = body.action === "start" ? 0 : room.current_question + 1;
      const question = questions?.find(q => q.position === index);
      if (!question) assertDatabaseResult(await db.from("game_rooms").update({ status: "finished", updated_at: new Date().toISOString() }).eq("id", room.id));
      else {
        const started = new Date(); const ends = new Date(started.getTime() + question.time_limit_seconds * 1000);
        assertDatabaseResult(await db.from("game_rooms").update({ status: "question", current_question: index, question_started_at: started.toISOString(), question_ends_at: ends.toISOString(), answer_count: 0, updated_at: started.toISOString() }).eq("id", room.id));
      }
    }
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
