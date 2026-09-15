import { NextResponse } from "next/server";
import { messageFrom } from "@/lib/validation";

type StructuredError = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  name?: unknown;
};

function clean(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/(service[_ -]?role|anon|api)[_ -]?key\s*[:=]\s*\S+/gi, "$1 key=[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 1_000);
}

function describeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: clean(error.message) ?? "Unknown error" };
  if (error && typeof error === "object") {
    const value = error as StructuredError;
    return {
      name: clean(value.name),
      code: clean(value.code),
      message: clean(value.message) ?? "Unknown structured error",
      details: clean(value.details),
      hint: clean(value.hint)
    };
  }
  return { message: clean(error) ?? "Unknown error" };
}

export function apiError(error: unknown, status = 400) {
  const diagnostic = describeError(error);
  console.error("[Quizloom API] Request failed", diagnostic);
  const message = diagnostic.message || messageFrom(error);
  const safe = message.includes("Supabase") || message.includes("SESSION_TOKEN") ? "This app is not connected to Supabase yet. Check the setup guide." : message;
  const structuredDatabaseError = Boolean(diagnostic.code);
  const clientMessage = structuredDatabaseError ? "A database request failed. Please try again." : safe;
  const responseStatus = message.includes("not configured") ? 503 : structuredDatabaseError ? 500 : status;
  return NextResponse.json({ error: clientMessage }, { status: responseStatus });
}

export function assertDatabaseResult(result: { error: unknown }) {
  if (result.error) throw result.error;
}
