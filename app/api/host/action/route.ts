import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError, assertDatabaseResult } from "@/lib/server/http";
import { safeEqualHash } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { toSafeCount } from "@/lib/runtime-normalization";

const schema = z.object({ code: roomCodeSchema, action: z.enum(["start", "reveal", "next", "end"]) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const db = getAdminClient();
    const { data: room, error: roomError } = await db.from("game_rooms")
      .select("id,quiz_id,status,current_question,question_started_at,question_ends_at,answer_count,room_secrets(host_token_hash)")
      .eq("code", body.code).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (roomError && roomError.code !== "PGRST116") throw roomError;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const relatedSecret = Array.isArray(room.room_secrets) ? room.room_secrets[0] : room.room_secrets;
    if (!relatedSecret || !safeEqualHash(request.headers.get("x-host-token"), relatedSecret.host_token_hash)) {
      return NextResponse.json({ error: "Host access is no longer valid" }, { status: 403 });
    }

    const alreadyEnded = room.status === "finished" && room.current_question === -1;
    if (body.action === "end") {
      if (!alreadyEnded) {
        const now = new Date().toISOString();
        const ended = await db.from("game_rooms").update({ status: "finished", current_question: -1, question_ends_at: now, updated_at: now })
          .eq("id", room.id).select("id,status,current_question").single();
        assertDatabaseResult(ended);
      }
      return NextResponse.json({ ok: true, status: "ended", alreadyEnded });
    }
    if (alreadyEnded || room.status === "finished") return NextResponse.json({ error: "This room has ended" }, { status: 409 });

    if (body.action === "reveal") {
      if (room.status !== "question") return NextResponse.json({ error: "There is no active question" }, { status: 409 });
      const { data: reveal, error: revealError } = await db.rpc("reveal_quiz_answer", { p_room_id: room.id }).single();
      if (revealError) throw revealError;
      return NextResponse.json({ ok: true, status: "results", correctOptionId: (reveal as { correct_option_id: string }).correct_option_id });
    }

    if (body.action === "start" && room.status !== "lobby") return NextResponse.json({ error: "The quiz has already started" }, { status: 409 });
    if (body.action === "next" && room.status !== "results") return NextResponse.json({ error: "Reveal the answer before continuing" }, { status: 409 });
    const index = body.action === "start" ? 0 : room.current_question + 1;
    const { data: question, error: questionError } = await db.from("questions")
      .select("id,prompt,position,time_limit_seconds,question_options(id,text,position)")
      .eq("quiz_id", room.quiz_id).eq("position", index).maybeSingle();
    if (questionError) throw questionError;

    if (!question) {
      const finished = await db.from("game_rooms").update({ status: "finished", updated_at: new Date().toISOString() })
        .eq("id", room.id).select("status,current_question,question_started_at,question_ends_at,answer_count").single();
      assertDatabaseResult(finished);
      if (!finished.data) throw new Error("The room did not finish correctly");
      return NextResponse.json({
        ok: true,
        transition: {
          room: {
            status: "finished",
            currentQuestion: finished.data.current_question,
            questionStartedAt: finished.data.question_started_at,
            questionEndsAt: finished.data.question_ends_at,
            answerCount: toSafeCount(finished.data.answer_count)
          }
        }
      });
    }

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + question.time_limit_seconds * 1000);
    const updated = await db.from("game_rooms").update({
      status: "question",
      current_question: index,
      question_started_at: startedAt.toISOString(),
      question_ends_at: endsAt.toISOString(),
      answer_count: 0,
      updated_at: startedAt.toISOString()
    }).eq("id", room.id).select("status,current_question,question_started_at,question_ends_at,answer_count").single();
    assertDatabaseResult(updated);
    if (!updated.data) throw new Error("The question did not start correctly");
    const options = [...(question.question_options ?? [])].sort((a, b) => a.position - b.position);
    return NextResponse.json({
      ok: true,
      transition: {
        room: {
          status: "question",
          currentQuestion: updated.data.current_question,
          questionStartedAt: updated.data.question_started_at,
          questionEndsAt: updated.data.question_ends_at,
          answerCount: toSafeCount(updated.data.answer_count)
        },
        question: {
          id: question.id,
          number: question.position + 1,
          prompt: question.prompt,
          timeLimit: question.time_limit_seconds,
          options: options.map(option => ({ id: option.id, text: option.text, position: option.position }))
        }
      }
    });
  } catch (error) { return apiError(error); }
}
