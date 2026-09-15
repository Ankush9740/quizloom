"use client";
import { useCallback, useEffect, useState } from "react";

export function Timer({ endsAt, startedAt }: { endsAt: string | null; startedAt: string | null }) {
  const calc = useCallback(() => Math.max(0, new Date(endsAt ?? 0).getTime() - Date.now()), [endsAt]); const [left, setLeft] = useState(calc);
  useEffect(() => { setLeft(calc()); const id = window.setInterval(() => setLeft(calc()), 100); return () => clearInterval(id); }, [calc]);
  const total = Math.max(1, new Date(endsAt ?? 0).getTime() - new Date(startedAt ?? 0).getTime()); const pct = Math.max(0, Math.min(100, left / total * 100)); const seconds = Math.ceil(left / 1000);
  return <div className="flex items-center gap-3" role="timer" aria-label={`${seconds} seconds remaining`}><div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10"><div className={`h-full rounded-full transition-[width] duration-100 ${seconds <= 5 ? "bg-coral" : "bg-blue"}`} style={{ width: `${pct}%` }}/></div><span className={`min-w-12 text-right font-[family-name:var(--font-display)] text-2xl font-bold ${seconds <= 5 ? "text-coral" : "text-ink"}`}>{seconds}s</span></div>;
}
