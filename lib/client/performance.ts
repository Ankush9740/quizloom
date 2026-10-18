type ClientTrace = {
  header: Record<string, string>;
  finish(response: Response): void;
};

type ClientTimer = {
  finish(operation: string, detail?: Record<string, unknown>): void;
};

function newTraceId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Creates a local Performance entry and correlates it with safe server timing headers. */
export function startClientTrace(operation: string): ClientTrace {
  const traceId = newTraceId();
  const startedAt = performance.now();

  return {
    header: { "x-quizloom-trace": traceId },
    finish(response) {
      const endedAt = performance.now();
      const serverTiming = response.headers.get("server-timing") ?? "";
      try {
        performance.measure(`quizloom:${operation}`, {
          start: startedAt,
          end: endedAt,
          detail: { traceId, status: response.status, serverTiming }
        });
      } catch {
        // Performance measurement must never affect gameplay.
      }
      if (process.env.NODE_ENV === "development") {
        console.info("[Quizloom performance]", {
          operation,
          traceId,
          status: response.status,
          clientTotalMs: Math.round((endedAt - startedAt) * 10) / 10,
          serverTiming
        });
      }
    }
  };
}

/** Starts a client-only measurement without coupling it to an HTTP response. */
export function startClientTimer(): ClientTimer {
  const startedAt = performance.now();

  return {
    finish(operation, detail) {
      recordClientDuration(operation, performance.now() - startedAt, detail);
    }
  };
}

/** Records a duration already measured against the calibrated server clock. */
export function recordClientDuration(operation: string, durationMs: number, detail?: Record<string, unknown>) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const endedAt = performance.now();
  try {
    performance.measure(`quizloom:${operation}`, {
      start: Math.max(0, endedAt - durationMs),
      end: endedAt,
      detail
    });
  } catch {
    // Performance measurement must never affect gameplay.
  }
}
