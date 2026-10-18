export type ServerClock = {
  serverTimeMs: number;
  monotonicTimeMs: number;
  uncertaintyMs: number;
};

export type ServerClockSample = {
  receivedAt: string;
  sentAt: string;
};

/** Estimates server time with the standard four-timestamp clock-offset calculation. */
export function estimateServerClock(sample: ServerClockSample, clientSentWallMs: number, clientReceivedWallMs: number, clientReceivedMonotonicMs: number): ServerClock | null {
  const serverReceivedMs = new Date(sample.receivedAt).getTime();
  const serverSentMs = new Date(sample.sentAt).getTime();
  if (![serverReceivedMs, serverSentMs, clientSentWallMs, clientReceivedWallMs, clientReceivedMonotonicMs].every(Number.isFinite)) return null;
  const offsetMs = ((serverReceivedMs - clientSentWallMs) + (serverSentMs - clientReceivedWallMs)) / 2;
  const roundTripMs = Math.max(0, clientReceivedWallMs - clientSentWallMs - Math.max(0, serverSentMs - serverReceivedMs));
  return { serverTimeMs: clientReceivedWallMs + offsetMs, monotonicTimeMs: clientReceivedMonotonicMs, uncertaintyMs: roundTripMs / 2 };
}

export function currentServerTime(clock: ServerClock | null, monotonicNowMs: number, wallNowMs: number) {
  return clock ? clock.serverTimeMs + Math.max(0, monotonicNowMs - clock.monotonicTimeMs) : wallNowMs;
}

export function deadlineRemainingMs(deadline: string | null, clock: ServerClock | null, monotonicNowMs: number, wallNowMs: number) {
  const deadlineMs = new Date(deadline ?? 0).getTime();
  if (!Number.isFinite(deadlineMs)) return 0;
  return Math.max(0, deadlineMs - currentServerTime(clock, monotonicNowMs, wallNowMs));
}

export function timeUntilStartMs(startedAt: string | null, clock: ServerClock | null, monotonicNowMs: number, wallNowMs: number) {
  const startedAtMs = new Date(startedAt ?? 0).getTime();
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, startedAtMs - currentServerTime(clock, monotonicNowMs, wallNowMs));
}

export type QuestionTiming = {
  phase: "countdown" | "answering" | "expired";
  milliseconds: number;
  seconds: number;
  progressPercent: number;
};

/** Derives all question UI timing from authoritative server timestamps. */
export function getQuestionTiming(startedAt: string | null, endsAt: string | null, clock: ServerClock | null, monotonicNowMs: number, wallNowMs: number): QuestionTiming {
  const untilStart = timeUntilStartMs(startedAt, clock, monotonicNowMs, wallNowMs);
  const remaining = deadlineRemainingMs(endsAt, clock, monotonicNowMs, wallNowMs);
  const startedAtMs = new Date(startedAt ?? 0).getTime();
  const endsAtMs = new Date(endsAt ?? 0).getTime();
  const duration = Number.isFinite(startedAtMs) && Number.isFinite(endsAtMs) ? Math.max(1, endsAtMs - startedAtMs) : 1;
  if (untilStart > 0) return { phase: "countdown", milliseconds: untilStart, seconds: Math.ceil(untilStart / 1_000), progressPercent: 100 };
  return {
    phase: remaining > 0 ? "answering" : "expired",
    milliseconds: remaining,
    seconds: Math.ceil(remaining / 1_000),
    progressPercent: Math.max(0, Math.min(100, remaining / duration * 100))
  };
}
