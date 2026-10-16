import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { hashToken } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { startServerTrace } from "@/lib/server/performance";

const schema = z.object({ code: roomCodeSchema, playerId: z.string().uuid(), optionId: z.string().uuid() });
export async function POST(request: Request) {
  const trace = startServerTrace(request, "answer.submit");
  try {
    const body = schema.parse(await request.json()); const token = request.headers.get("x-player-token");
    if (!token) return trace.response(NextResponse.json({ error: "Your player session has expired" }, { status: 401 }));
    const { error } = await getAdminClient().rpc("submit_quiz_answer_v2", { p_room_code: body.code, p_player_id: body.playerId, p_player_token_hash: hashToken(token), p_option_id: body.optionId });
    trace.mark("submit-rpc");
    if (error) throw new Error(error.message.replace(/^P0001: /, ""));
    // Correctness and awarded points remain server-only until the host reveals.
    return trace.response(NextResponse.json({ accepted: true }));
  } catch (error) { return trace.response(apiError(error)); }
}
