import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { createSessionToken, hashToken } from "@/lib/server/session";
import { apiError } from "@/lib/server/http";
import { avatarSchema, nicknameSchema, roomCodeSchema } from "@/lib/validation";
import { z } from "zod";
import { normalizeAvatarConfig } from "@/lib/runtime-normalization";
import { startServerTrace } from "@/lib/server/performance";

const joinSchema = z.object({ code: roomCodeSchema, nickname: nicknameSchema, avatar: avatarSchema, playerId: z.string().uuid().optional() });

export async function POST(request: Request) {
  const trace = startServerTrace(request, "player.join");
  try {
    const body = joinSchema.parse(await request.json()); const db = getAdminClient();
    const reconnectToken = request.headers.get("x-player-token");
    const playerToken = createSessionToken();
    const { data, error } = await db.rpc("join_quiz_room", {
      p_room_code: body.code,
      p_nickname: body.nickname.trim().replace(/\s+/g, " "),
      p_avatar: normalizeAvatarConfig(body.avatar),
      p_existing_player_id: body.playerId ?? null,
      p_reconnect_token_hash: reconnectToken ? hashToken(reconnectToken) : null,
      p_new_player_token_hash: hashToken(playerToken)
    });
    trace.mark("join-rpc");
    if (error) throw error;
    const result = data as { kind?: string; playerId?: string; nickname?: string } | null;
    if (result?.kind === "missing") return trace.response(NextResponse.json({ error: "Invalid room code." }, { status: 404 }));
    if (result?.kind === "ended") return trace.response(NextResponse.json({ error: "This room has ended." }, { status: 410 }));
    if (result?.kind === "expired") return trace.response(NextResponse.json({ error: "This room has expired." }, { status: 410 }));
    if (result?.kind === "started") return trace.response(NextResponse.json({ error: "That quiz has already started." }, { status: 409 }));
    if (result?.kind === "nickname-taken") return trace.response(NextResponse.json({ error: "That nickname is already taken in this room" }, { status: 409 }));
    if (!result?.playerId || !result.nickname) throw new Error("The player session was not created");
    if (result.kind === "reconnected" && reconnectToken) {
      return trace.response(NextResponse.json({ playerId: result.playerId, nickname: result.nickname, playerToken: reconnectToken, reconnected: true }));
    }
    if (result.kind !== "created") throw new Error("The player session was not created");
    return trace.response(NextResponse.json({ playerId: result.playerId, nickname: result.nickname, playerToken }, { status: 201 }));
  } catch (error) { return trace.response(apiError(error)); }
}
