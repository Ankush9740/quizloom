import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { createSessionToken, hashToken, safeEqualHash } from "@/lib/server/session";
import { apiError } from "@/lib/server/http";
import { avatarSchema, nicknameSchema, roomCodeSchema } from "@/lib/validation";
import { z } from "zod";
import { normalizeAvatarConfig } from "@/lib/runtime-normalization";

const joinSchema = z.object({ code: roomCodeSchema, nickname: nicknameSchema, avatar: avatarSchema, playerId: z.string().uuid().optional() });

export async function POST(request: Request) {
  try {
    const body = joinSchema.parse(await request.json()); const db = getAdminClient();
    const { data: room, error: roomError } = await db.from("game_rooms").select("id,status,expires_at").eq("code", body.code).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (roomError && roomError.code !== "PGRST116") throw roomError;
    if (!room) return NextResponse.json({ error: "Invalid room code." }, { status: 404 });
    if (room.status === "finished") return NextResponse.json({ error: "This room has ended." }, { status: 410 });
    if (!Number.isFinite(new Date(room.expires_at).getTime()) || new Date(room.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This room has expired." }, { status: 410 });
    if (room.status !== "lobby") return NextResponse.json({ error: "That quiz has already started." }, { status: 409 });
    const reconnectToken = request.headers.get("x-player-token");
    if (body.playerId && reconnectToken) {
      const [{ data: existing }, { data: secret }] = await Promise.all([
        db.from("players").select("id,nickname").eq("id", body.playerId).eq("room_id", room.id).maybeSingle(),
        db.from("player_secrets").select("player_token_hash").eq("player_id", body.playerId).maybeSingle()
      ]);
      if (existing && secret && safeEqualHash(reconnectToken, secret.player_token_hash)) return NextResponse.json({ playerId: existing.id, nickname: existing.nickname, playerToken: reconnectToken, reconnected: true });
    }
    const playerToken = createSessionToken();
    const { data: player, error } = await db.from("players").insert({ room_id: room.id, nickname: body.nickname.trim().replace(/\s+/g, " "), avatar_config: normalizeAvatarConfig(body.avatar) }).select("id,nickname").single();
    if (error?.code === "23505") return NextResponse.json({ error: "That nickname is already taken in this room" }, { status: 409 });
    if (error) throw error;
    const { error: secretError } = await db.from("player_secrets").insert({ player_id: player.id, player_token_hash: hashToken(playerToken) });
    if (secretError) { await db.from("players").delete().eq("id", player.id); throw secretError; }
    return NextResponse.json({ playerId: player.id, nickname: player.nickname, playerToken }, { status: 201 });
  } catch (error) { return apiError(error); }
}
