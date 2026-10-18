type TimingStage = { name: string; durationMs: number };

function safeTraceId(value: string | null) {
  return value && /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : crypto.randomUUID();
}

function round(durationMs: number) {
  return Math.round(durationMs * 10) / 10;
}

/** Lightweight request timing that never records request bodies, tokens, or identifiers. */
export function startServerTrace(request: Request, operation: string) {
  const traceId = safeTraceId(request.headers.get("x-quizloom-trace"));
  const startedAt = performance.now();
  let previousAt = startedAt;
  const stages: TimingStage[] = [];

  return {
    mark(name: string) {
      const now = performance.now();
      stages.push({ name: name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 40), durationMs: now - previousAt });
      previousAt = now;
    },
    response<T extends Response>(response: T): T {
      const totalMs = performance.now() - startedAt;
      const timing = [
        `total;dur=${round(totalMs)}`,
        ...stages.map(stage => `${stage.name};dur=${round(stage.durationMs)}`)
      ].join(", ");
      response.headers.set("Server-Timing", timing);
      response.headers.set("X-Quizloom-Trace", traceId);

      if (process.env.NODE_ENV === "development" || process.env.QUIZLOOM_PERF_LOGGING === "1") {
        console.info("[Quizloom performance]", {
          operation,
          traceId,
          status: response.status,
          totalMs: round(totalMs),
          stages: Object.fromEntries(stages.map(stage => [stage.name, round(stage.durationMs)]))
        });
      }
      return response;
    }
  };
}
