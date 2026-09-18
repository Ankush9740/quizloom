import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { canAccessQuiz } from "@/lib/server/quiz-access";
import { createRoomForQuiz } from "@/lib/server/rooms";
import { apiError } from "@/lib/server/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getAdminClient();
  try {
    const id = z.string().uuid().parse((await params).id);
    if (!await canAccessQuiz(db, id, request.headers.get("x-quiz-token"))) return NextResponse.json({ error: "Quiz access is not valid on this device" }, { status: 403 });
    const result = await createRoomForQuiz(db, id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
