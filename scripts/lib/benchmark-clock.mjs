export function estimateResponseClock(result) {
  const receivedAtValue = result.body?.clock?.receivedAt;
  const sentAtValue = result.body?.clock?.sentAt;
  if (typeof receivedAtValue !== "string" || typeof sentAtValue !== "string") return null;
  const receivedAt = new Date(receivedAtValue).getTime();
  const sentAt = new Date(sentAtValue).getTime();
  if (![receivedAt, sentAt, result.clientSentWallMs, result.clientReceivedWallMs].every(Number.isFinite)) return null;
  const offsetMs = ((receivedAt - result.clientSentWallMs) + (sentAt - result.clientReceivedWallMs)) / 2;
  const serverDurationMs = Math.max(0, sentAt - receivedAt);
  const networkRoundTripMs = Math.max(0, result.clientReceivedWallMs - result.clientSentWallMs - serverDurationMs);
  return {
    serverNowAtReceiveMs: result.clientReceivedWallMs + offsetMs,
    uncertaintyMs: networkRoundTripMs / 2,
    requestArrivalMs: Math.max(0, receivedAt - (result.clientSentWallMs + offsetMs)),
    responseReturnMs: Math.max(0, result.clientReceivedWallMs + offsetMs - sentAt)
  };
}

export function observeScheduledStart(result) {
  const scheduledStartValue = result.body?.room?.questionStartedAt;
  const scheduledEndValue = result.body?.room?.questionEndsAt;
  if (typeof scheduledStartValue !== "string") return null;
  const scheduledStartMs = new Date(scheduledStartValue).getTime();
  const scheduledEndMs = typeof scheduledEndValue === "string" ? new Date(scheduledEndValue).getTime() : Number.NaN;
  const clock = estimateResponseClock(result);
  if (!Number.isFinite(scheduledStartMs) || !clock) return null;
  const headroomMs = scheduledStartMs - clock.serverNowAtReceiveMs;
  const classification = headroomMs + clock.uncertaintyMs < 0
    ? "confirmedLate"
    : headroomMs - clock.uncertaintyMs >= 0
      ? "confirmedReady"
      : "uncertain";
  return {
    headroomMs,
    classification,
    uncertaintyMs: clock.uncertaintyMs,
    requestArrivalMs: clock.requestArrivalMs,
    responseReturnMs: clock.responseReturnMs,
    authoritativeDurationMs: Number.isFinite(scheduledEndMs) ? scheduledEndMs - scheduledStartMs : null
  };
}
