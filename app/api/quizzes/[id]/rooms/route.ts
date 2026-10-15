import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { canAccessQuiz } from "@/lib/server/quiz-access";
import { createRoomForQuiz } from "@/lib/server/rooms";
import { apiError } from "@/lib/server/http";
import { startServerTrace } from "@/lib/server/performance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const trace = startServerTrace(request, "room.create");
  const db = getAdminClient();
  try {
    const id = z.string().uuid().parse((await params).id);
    if (!await canAccessQuiz(db, id, request.headers.get("x-quiz-token"))) return trace.response(NextResponse.json({ error: "Quiz access is not valid on this device" }, { status: 403 }));
    trace.mark("authorize");
    const result = await createRoomForQuiz(db, id, trace.mark);
    if ("error" in result) return trace.response(NextResponse.json({ error: result.error }, { status: 409 }));
    return trace.response(NextResponse.json(result, { status: 201 }));
  } catch (error) { return trace.response(apiError(error)); }
}
