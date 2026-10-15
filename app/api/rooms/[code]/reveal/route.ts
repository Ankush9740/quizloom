import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { apiError } from "@/lib/server/http";
import { startServerTrace } from "@/lib/server/performance";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const trace = startServerTrace(request, "reveal.hydrate");
  try {
    const code = roomCodeSchema.parse((await params).code); const playerId = z.string().uuid().parse(new URL(request.url).searchParams.get("playerId")); const token = request.headers.get("x-player-token");
    if (!token) return trace.response(NextResponse.json({ error: "Your player session has expired" }, { status: 401 }));
    const { data, error } = await getAdminClient().rpc("get_player_reveal", { p_room_code: code, p_player_id: playerId, p_player_token_hash: hashToken(token) });
    trace.mark("reveal-rpc");
    if (error) throw new Error(error.message.replace(/^P0001: /, ""));
    return trace.response(NextResponse.json(data, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) { return trace.response(apiError(error)); }
}
