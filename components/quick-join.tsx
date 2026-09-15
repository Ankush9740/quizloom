"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

export function QuickJoin() {
  const router = useRouter(); const [code, setCode] = useState("");
  function submit(e: React.FormEvent) { e.preventDefault(); if (/^\d{6}$/.test(code)) router.push(`/join?code=${code}`); }
  return <form onSubmit={submit} className="card p-6 sm:p-9">
    <p className="text-sm font-extrabold uppercase tracking-[.18em] text-blue">Player entrance</p>
    <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Got a game code?</h2>
    <label htmlFor="room-code" className="mt-8 block text-sm font-bold">Six-digit code</label>
    <input id="room-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="482913" className="field mt-2 text-center font-[family-name:var(--font-display)] text-4xl font-bold tracking-[.25em]" />
    <button className="btn-primary mt-4 w-full" disabled={code.length !== 6}>Enter the room <ArrowRight size={19}/></button>
    <p className="mt-5 text-center text-sm text-ink/45">No account. Just your nickname and your look.</p>
  </form>;
}
