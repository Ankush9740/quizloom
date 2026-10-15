import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError, assertDatabaseResult } from "@/lib/server/http";
import { canAccessQuiz, quizDocumentFromRows } from "@/lib/server/quiz-access";
import { createRoomForQuiz } from "@/lib/server/rooms";
import { portableQuizSchema } from "@/lib/validation";
import { insertQuestions } from "@/app/api/quizzes/route";
import { startServerTrace } from "@/lib/server/performance";

const idSchema = z.string().uuid();

async function finishExpiredRooms(db: ReturnType<typeof getAdminClient>, quizId: string) {
  const now = new Date().toISOString();
  const result = await db.from("game_rooms").update({
    status: "finished",
    current_question: -1,
    question_ends_at: now,
    updated_at: now
  }).eq("quiz_id", quizId).in("status", ["lobby", "question", "results"]).lte("expires_at", now);
  assertDatabaseResult(result);
  return now;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idSchema.parse((await params).id); const db = getAdminClient();
    if (!await canAccessQuiz(db, id, request.headers.get("x-quiz-token"))) return NextResponse.json({ error: "Quiz access is not valid on this device" }, { status: 403 });
    const { data, error } = await db.from("quizzes").select("title,description,points_per_correct,questions(prompt,position,time_limit_seconds,question_options(text,position,is_correct))").eq("id", id).single();
    if (error) throw error;
    return NextResponse.json(quizDocumentFromRows(data));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const trace = startServerTrace(request, "room.create");
  try {
    const id = idSchema.parse((await params).id); const db = getAdminClient();
    if (!await canAccessQuiz(db, id, request.headers.get("x-quiz-token"))) return trace.response(NextResponse.json({ error: "Quiz access is not valid on this device" }, { status: 403 }));
    trace.mark("authorize");
    const result = await createRoomForQuiz(db, id, trace.mark);
    if ("error" in result) return trace.response(NextResponse.json({ error: result.error }, { status: 409 }));
    return trace.response(NextResponse.json(result, { status: 201 }));
  } catch (error) { return trace.response(apiError(error)); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getAdminClient();
  try {
    const id = idSchema.parse((await params).id); const document = portableQuizSchema.parse(await request.json());
    if (!await canAccessQuiz(db, id, request.headers.get("x-quiz-token"))) return NextResponse.json({ error: "Quiz access is not valid on this device" }, { status: 403 });
    const now = await finishExpiredRooms(db, id);
    const { count, error: roomError } = await db.from("game_rooms").select("id", { count: "exact", head: true }).eq("quiz_id", id).in("status", ["lobby", "question", "results"]).gt("expires_at", now);
    if (roomError) throw roomError;
    if (count) return NextResponse.json({ error: "Finish the active room before editing this quiz" }, { status: 409 });
    assertDatabaseResult(await db.from("questions").delete().eq("quiz_id", id));
    assertDatabaseResult(await db.from("quizzes").update({ title: document.title, description: document.description, points_per_correct: document.pointsPerCorrectAnswer, updated_at: new Date().toISOString() }).eq("id", id));
    await insertQuestions(db, id, document.questions);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getAdminClient();
  try {
    const id = idSchema.parse((await params).id);
    if (!await canAccessQuiz(db, id, request.headers.get("x-quiz-token"))) return NextResponse.json({ error: "Quiz access is not valid on this device" }, { status: 403 });
    const now = await finishExpiredRooms(db, id);
    const { count, error: roomError } = await db.from("game_rooms").select("id", { count: "exact", head: true }).eq("quiz_id", id).in("status", ["lobby", "question", "results"]).gt("expires_at", now);
    if (roomError) throw roomError;
    if (count) return NextResponse.json({ error: "Finish the active room before deleting this quiz" }, { status: 409 });
    const { data: deleted, error: deleteError } = await db.from("quizzes").delete().eq("id", id).select("id").maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deletedQuizId: id });
  } catch (error) { return apiError(error); }
}
