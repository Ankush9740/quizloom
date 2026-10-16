import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { createRoomForQuiz } from "@/lib/server/rooms";
import { apiError } from "@/lib/server/http";
import { startServerTrace } from "@/lib/server/performance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const trace = startServerTrace(request, "room.create");
  const db = getAdminClient();
  try {
    const id = z.string().uuid().parse((await params).id);
    const result = await createRoomForQuiz(db, id, request.headers.get("x-quiz-token"), trace.mark);
    if ("error" in result) return trace.response(NextResponse.json({ error: result.error }, { status: result.status }));
    return trace.response(NextResponse.json(result, { status: 201 }));
  } catch (error) { return trace.response(apiError(error)); }
}
