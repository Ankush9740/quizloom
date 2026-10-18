"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getQuestionTiming, type ServerClock } from "@/lib/server-clock";

export function Timer({ endsAt, startedAt, clock, onStart, onExpire, children }: { endsAt: string | null; startedAt: string | null; clock: ServerClock | null; onStart?: () => void; onExpire?: () => void; children?: ReactNode }) {
  const calculate = useCallback(() => getQuestionTiming(startedAt, endsAt, clock, performance.now(), Date.now()), [clock, endsAt, startedAt]);
  const [timing, setTiming] = useState(calculate); const started = useRef(false); const expired = useRef(false); const onStartRef = useRef(onStart); const onExpireRef = useRef(onExpire);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);
  useEffect(() => {
    started.current = false; expired.current = false;
    const update = () => {
      const next = calculate(); setTiming(next);
      if (next.phase !== "countdown" && !started.current) { started.current = true; onStartRef.current?.(); }
      if (next.phase === "expired" && !expired.current) { expired.current = true; onExpireRef.current?.(); }
    };
    update(); const id = window.setInterval(update, 100);
    const resume = () => { if (document.visibilityState === "visible") update(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("focus", update); window.addEventListener("pageshow", update);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", update); window.removeEventListener("pageshow", update); };
  }, [calculate]);
  const waiting = timing.phase === "countdown";
  return <>
    <div className="flex items-center gap-3" role="timer" aria-label={waiting ? `Question starts in ${timing.seconds} seconds` : `${timing.seconds} seconds remaining`}><div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10"><div className={`h-full rounded-full transition-[width] duration-100 ${!waiting && timing.seconds <= 5 ? "bg-coral" : "bg-blue"}`} style={{ width: `${timing.progressPercent}%` }}/></div><span className={`min-w-24 whitespace-nowrap text-right font-[family-name:var(--font-display)] text-2xl font-bold ${!waiting && timing.seconds <= 5 ? "text-coral" : "text-ink"}`}>{waiting ? `Starts in ${timing.seconds}s` : `${timing.seconds}s`}</span></div>
    {waiting ? <div className="card mt-6 grid min-h-64 place-items-center p-8 text-center" aria-live="polite"><div><p className="text-sm font-extrabold uppercase tracking-[.18em] text-blue">Get ready</p><p className="mt-3 font-[family-name:var(--font-display)] text-7xl font-bold text-ink">{timing.seconds}</p><p className="mt-3 font-bold text-ink/55">The question will appear when answering begins.</p></div></div> : children}
  </>;
}
