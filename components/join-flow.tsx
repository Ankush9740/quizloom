"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { AvatarBuilder } from "@/components/avatar-builder";
import { Logo } from "@/components/logo";
import { defaultAvatar } from "@/lib/avatar-defaults";
import { readJsonResponse } from "@/lib/client/http";
import type { AvatarConfig } from "@/lib/types";

type RoomLookup = { title: string };
type JoinResult = { playerId: string; playerToken: string; nickname: string };

function usefulJoinError(error: unknown) {
  if (error instanceof TypeError) return "Unable to connect. Check the network and try again.";
  return error instanceof Error && error.message.trim() ? error.message : "Unable to connect. Please try again.";
}

export function JoinFlow() {
  const params = useSearchParams(); const router = useRouter(); const [code, setCode] = useState(params.get("code")?.replace(/\D/g, "").slice(0, 6) ?? ""); const [room, setRoom] = useState<RoomLookup | null>(null); const [nickname, setNickname] = useState(""); const [avatar, setAvatar] = useState<AvatarConfig>(defaultAvatar); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const validate = useCallback(async () => { setBusy(true); setError(""); try { const r = await fetch(`/api/rooms/${code}`, { headers: { Accept: "application/json" } }); setRoom(await readJsonResponse<RoomLookup>(r)); } catch(e) { setError(usefulJoinError(e)); } finally { setBusy(false); } }, [code]);
  useEffect(() => { if (code.length === 6) void validate(); }, [code.length, validate]);
  async function join() { setBusy(true); setError(""); try { const storageKey = `quizloom:player:${code}`; let saved: { playerId?: string; playerToken?: string } | null = null; try { saved = JSON.parse(localStorage.getItem(storageKey) ?? "null"); } catch { localStorage.removeItem(storageKey); } const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" }; if (saved?.playerToken) headers["x-player-token"] = saved.playerToken; const r = await fetch("/api/players/join", { method: "POST", headers, body: JSON.stringify({ code, nickname, avatar, ...(saved?.playerId ? { playerId: saved.playerId } : {}) }) }); const j = await readJsonResponse<JoinResult>(r); localStorage.setItem(storageKey, JSON.stringify({ playerId: j.playerId, playerToken: j.playerToken, nickname: j.nickname })); router.push(`/play/${code}`); } catch(e) { setError(usefulJoinError(e)); setBusy(false); } }
  return <main className="grid-paper min-h-screen px-5 py-5"><div className="mx-auto max-w-3xl"><Logo/><div className="card mt-8 p-6 sm:p-9">
    {!room ? <><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft size={16}/> Home</Link><p className="mt-7 text-sm font-extrabold uppercase tracking-[.16em] text-blue">Step 1 of 2</p><h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">Find your room</h1><label className="mt-7 block text-sm font-bold" htmlFor="code">Game code</label><input id="code" className="field mt-2 text-center font-[family-name:var(--font-display)] text-4xl font-bold tracking-[.25em]" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="482913"/><button onClick={() => void validate()} disabled={code.length !== 6 || busy} className="btn-primary mt-4 w-full">{busy ? "Checking…" : <>Continue <ArrowRight size={18}/></>}</button></> : <><button onClick={() => { setRoom(null); setError(""); }} className="inline-flex items-center gap-2 text-sm font-bold text-ink/55"><ArrowLeft size={16}/> Change room</button><p className="mt-7 text-sm font-extrabold uppercase tracking-[.16em] text-coral">Step 2 of 2</p><h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Make your entrance</h1><p className="mt-2 flex items-center gap-2 text-ink/60"><CheckCircle2 size={17} className="text-mint"/> Joining <strong>{room.title}</strong></p><label className="mt-7 block text-sm font-bold" htmlFor="nickname">Nickname</label><input id="nickname" className="field mt-2" value={nickname} onChange={e => setNickname(e.target.value)} maxLength={18} autoComplete="nickname" placeholder="What should we call you?"/><div className="my-7 h-px bg-ink/10"/><AvatarBuilder value={avatar} onChange={setAvatar}/><button onClick={join} disabled={nickname.trim().length < 2 || busy} className="btn-primary mt-8 w-full">{busy ? "Joining…" : <>I&apos;m ready <ArrowRight size={18}/></>}</button></>}
    {error && <p role="alert" className="mt-4 rounded-2xl bg-coral/10 p-4 text-sm font-bold text-red-700">{error}</p>}
  </div></div></main>;
}
