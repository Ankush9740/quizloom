import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/server/session";
import { roomCodeSchema } from "@/lib/validation";
import { apiError } from "@/lib/server/http";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = roomCodeSchema.parse((await params).code); const playerId = z.string().uuid().parse(new URL(request.url).searchParams.get("playerId")); const token = request.headers.get("x-player-token");
    if (!token) return NextResponse.json({ error: "Your player session has expired" }, { status: 401 });
    const { data, error } = await getAdminClient().rpc("get_player_reveal", { p_room_code: code, p_player_id: playerId, p_player_token_hash: hashToken(token) });
    if (error) throw new Error(error.message.replace(/^P0001: /, ""));
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
