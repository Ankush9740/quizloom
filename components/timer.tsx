"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { deadlineRemainingMs, timeUntilStartMs, type ServerClock } from "@/lib/server-clock";

export function Timer({ endsAt, startedAt, clock, onStart, onExpire }: { endsAt: string | null; startedAt: string | null; clock: ServerClock | null; onStart?: () => void; onExpire?: () => void }) {
  const calculate = useCallback(() => ({
    untilStart: timeUntilStartMs(startedAt, clock, performance.now(), Date.now()),
    remaining: deadlineRemainingMs(endsAt, clock, performance.now(), Date.now())
  }), [clock, endsAt, startedAt]);
  const [timing, setTiming] = useState(calculate); const started = useRef(false); const expired = useRef(false); const onStartRef = useRef(onStart); const onExpireRef = useRef(onExpire);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);
  useEffect(() => {
    started.current = false; expired.current = false;
    const update = () => {
      const next = calculate(); setTiming(next);
      if (next.untilStart === 0 && !started.current) { started.current = true; onStartRef.current?.(); }
      if (next.untilStart === 0 && next.remaining === 0 && !expired.current) { expired.current = true; onExpireRef.current?.(); }
    };
    update(); const id = window.setInterval(update, 100);
    const resume = () => { if (document.visibilityState === "visible") update(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("focus", update); window.addEventListener("pageshow", update);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", update); window.removeEventListener("pageshow", update); };
  }, [calculate]);
  const waiting = timing.untilStart > 0; const shownMs = waiting ? timing.untilStart : timing.remaining; const total = Math.max(1, new Date(endsAt ?? 0).getTime() - new Date(startedAt ?? 0).getTime()); const pct = waiting ? 100 : Math.max(0, Math.min(100, timing.remaining / total * 100)); const seconds = Math.ceil(shownMs / 1000);
  return <div className="flex items-center gap-3" role="timer" aria-label={waiting ? `Question starts in ${seconds} seconds` : `${seconds} seconds remaining`}><div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10"><div className={`h-full rounded-full transition-[width] duration-100 ${!waiting && seconds <= 5 ? "bg-coral" : "bg-blue"}`} style={{ width: `${pct}%` }}/></div><span className={`min-w-12 whitespace-nowrap text-right font-[family-name:var(--font-display)] text-2xl font-bold ${!waiting && seconds <= 5 ? "text-coral" : "text-ink"}`}>{waiting ? `Starts in ${seconds}s` : `${seconds}s`}</span></div>;
}
