const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function classifyRealtimeSystemError(payload) {
  if (payload?.status !== "error") return null;
  const message = String(payload?.message ?? "").toLowerCase();
  if (message.includes("too many joins") || message.includes("too_many_joins") || message.includes("joinratelimit") || message.includes("join_rate_limit")) return "channel-join-rate-limit";
  if (message.includes("too many connections") || message.includes("too_many_connections") || message.includes("too many connected users")) return "connection-limit";
  if (message.includes("too many messages") || message.includes("tenant_events")) return "message-rate-limit";
  if (message.includes("presence")) return "presence-rate-limit";
  if (message.includes("database timeout") || message.includes("increaseconnectionpool")) return "realtime-database-timeout";
  if (message.includes("replication")) return "replication-error";
  if (message.includes("token") || message.includes("jwt")) return "authorization-error";
  return "system-error";
}

export async function runInBatches(items, worker, {
  batchSize,
  staggerMs,
  wait = delay
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer");
  if (!Number.isInteger(staggerMs) || staggerMs < 0) throw new Error("staggerMs must be a non-negative integer");

  for (let offset = 0; offset < items.length; offset += batchSize) {
    await Promise.all(items.slice(offset, offset + batchSize).map(worker));
    if (offset + batchSize < items.length && staggerMs > 0) await wait(staggerMs);
  }
}

export function waitForRealtimeSubscription(channel, health, {
  timeoutMs,
  diagnostics,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = callback => {
      if (settled) return;
      settled = true;
      clearTimer(timeout);
      callback();
    };
    const timeout = setTimer(() => {
      settle(() => reject(new Error(`Realtime subscription timed out (${diagnostics()})`)));
    }, timeoutMs);

    channel.subscribe((status, error) => {
      health.lastStatus = status;
      health.statusChanges++;
      if (status === "SUBSCRIBED") {
        health.subscribedCount++;
        health.reconnects = Math.max(0, health.subscribedCount - 1);
        settle(resolve);
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        health.failures++;
        health.lastFailureType = error instanceof Error ? error.name : status;
      }

      // realtime-js automatically schedules a rejoin after TIMED_OUT and
      // CHANNEL_ERROR. Keep the original overall readiness deadline instead of
      // failing on the first transient join response. CLOSED cannot recover.
      if (status === "CLOSED") {
        settle(() => reject(new Error(`Realtime subscription closed (${diagnostics()})`)));
      }
    });
  });
}
