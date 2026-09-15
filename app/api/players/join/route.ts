import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { createSessionToken, hashToken } from "@/lib/server/session";
import { apiError } from "@/lib/server/http";
import { avatarSchema, nicknameSchema, roomCodeSchema } from "@/lib/validation";
import { z } from "zod";

const joinSchema = z.object({ code: roomCodeSchema, nickname: nicknameSchema, avatar: avatarSchema });

export async function POST(request: Request) {
  try {
    const body = joinSchema.parse(await request.json()); const db = getAdminClient();
    const { data: room, error: roomError } = await db.from("game_rooms").select("id,status,expires_at").eq("code", body.code).single();
    if (roomError && roomError.code !== "PGRST116") throw roomError;
    if (!room) return NextResponse.json({ error: "That room could not be found" }, { status: 404 });
    if (room.status !== "lobby" || new Date(room.expires_at).getTime() < Date.now()) return NextResponse.json({ error: "That quiz is no longer accepting players" }, { status: 409 });
    const playerToken = createSessionToken();
    const { data: player, error } = await db.from("players").insert({ room_id: room.id, nickname: body.nickname.trim().replace(/\s+/g, " "), avatar_config: body.avatar }).select("id,nickname").single();
    if (error?.code === "23505") return NextResponse.json({ error: "That nickname is already taken in this room" }, { status: 409 });
    if (error) throw error;
    const { error: secretError } = await db.from("player_secrets").insert({ player_id: player.id, player_token_hash: hashToken(playerToken) });
    if (secretError) { await db.from("players").delete().eq("id", player.id); throw secretError; }
    return NextResponse.json({ playerId: player.id, nickname: player.nickname, playerToken }, { status: 201 });
  } catch (error) { return apiError(error); }
}
