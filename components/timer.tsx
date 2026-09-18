"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { deadlineRemainingMs, type ServerClock } from "@/lib/server-clock";

export function Timer({ endsAt, startedAt, clock, onExpire }: { endsAt: string | null; startedAt: string | null; clock: ServerClock | null; onExpire?: () => void }) {
  const calculate = useCallback(() => deadlineRemainingMs(endsAt, clock, performance.now(), Date.now()), [clock, endsAt]);
  const [left, setLeft] = useState(calculate); const expired = useRef(false); const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);
  useEffect(() => {
    expired.current = false;
    const update = () => {
      const remaining = calculate(); setLeft(remaining);
      if (remaining === 0 && !expired.current) { expired.current = true; onExpireRef.current?.(); }
    };
    update(); const id = window.setInterval(update, 100);
    const resume = () => { if (document.visibilityState === "visible") update(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("focus", update); window.addEventListener("pageshow", update);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", update); window.removeEventListener("pageshow", update); };
  }, [calculate]);
  const total = Math.max(1, new Date(endsAt ?? 0).getTime() - new Date(startedAt ?? 0).getTime()); const pct = Math.max(0, Math.min(100, left / total * 100)); const seconds = Math.ceil(left / 1000);
  return <div className="flex items-center gap-3" role="timer" aria-label={`${seconds} seconds remaining`}><div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10"><div className={`h-full rounded-full transition-[width] duration-100 ${seconds <= 5 ? "bg-coral" : "bg-blue"}`} style={{ width: `${pct}%` }}/></div><span className={`min-w-12 text-right font-[family-name:var(--font-display)] text-2xl font-bold ${seconds <= 5 ? "text-coral" : "text-ink"}`}>{seconds}s</span></div>;
}
