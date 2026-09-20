import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) throw new Error("Supabase configuration is required");
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anonDb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

for (const [table, columns] of [
  ["game_rooms", "id,speed_ranking_enabled"],
  ["players", "id,correct_response_time_ms"],
  ["answers", "id,response_time_ms"]
]) {
  const { error } = await db.from(table).select(columns).limit(1);
  if (error) throw new Error(`${table} migration columns are unavailable: ${error.message}`);
}

const missingTransition = await db.rpc("get_quiz_room_transition", { p_room_code: "000000", p_question_index: 0 });
if (missingTransition.error) throw new Error(`get_quiz_room_transition is unavailable: ${missingTransition.error.message}`);
if (missingTransition.data?.kind !== "missing") throw new Error("get_quiz_room_transition returned an unexpected verification result");

const invalidRoomTransition = await db.rpc("transition_quiz_room", { p_room_id: randomUUID(), p_action: "start", p_start_lead_ms: 3000 });
if (!invalidRoomTransition.error?.message.includes("Room not found")) throw new Error(`transition_quiz_room verification failed: ${invalidRoomTransition.error?.message ?? "no expected error"}`);

for (const [name, args] of [
  ["get_quiz_room_transition", { p_room_code: "000000", p_question_index: 0 }],
  ["transition_quiz_room", { p_room_id: randomUUID(), p_action: "start", p_start_lead_ms: 3000 }],
  ["reveal_quiz_answer", { p_room_id: randomUUID() }],
  ["submit_quiz_answer", { p_room_code: "000000", p_player_id: randomUUID(), p_player_token_hash: "verification", p_option_id: randomUUID() }]
]) {
  const result = await anonDb.rpc(name, args);
  if (result.error?.code !== "42501") throw new Error(`${name} must reject anonymous execution`);
}

console.log("Migration 006 verification passed: all new columns and RPC functions are available through the service role and reject anonymous execution.");
