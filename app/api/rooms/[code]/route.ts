import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/server/http";
import { roomCodeSchema } from "@/lib/validation";

export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = roomCodeSchema.parse((await params).code);
    const db = getAdminClient();
    const { data, error } = await db.from("game_rooms").select("id,code,status,expires_at,quizzes(title)").eq("code", code).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!data) return NextResponse.json({ error: "Invalid room code." }, { status: 404 });
    if (data.status === "finished") return NextResponse.json({ error: "This room has ended." }, { status: 410 });
    if (!Number.isFinite(new Date(data.expires_at).getTime()) || new Date(data.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This room has expired." }, { status: 410 });
    if (data.status !== "lobby") return NextResponse.json({ error: "That quiz has already started" }, { status: 409 });
    const quiz = Array.isArray(data.quizzes) ? data.quizzes[0] : data.quizzes;
    return NextResponse.json({ code: data.code, title: (quiz as { title: string } | null)?.title ?? "Live quiz" });
  } catch (error) { return apiError(error); }
}
