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
