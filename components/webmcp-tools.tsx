"use client";
import { useEffect } from "react";

declare global {
  interface Document { modelContext?: { registerTool(tool: { name: string; title: string; description: string; inputSchema: object; execute(input: unknown): unknown; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean } }, options: { signal: AbortSignal }): void | Promise<void> } }
}

export function WebMcpTools() {
  useEffect(() => {
    const context = document.modelContext; if (!context?.registerTool) return; const lifecycle = new AbortController();
    const navigate = (path: string) => { window.location.assign(path); return { navigatingTo: path }; };
    try {
      void Promise.resolve(context.registerTool({ name: "start_quiz_creation", title: "Build a quiz", description: "Open the Quizloom quiz builder for a host.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, execute: () => navigate("/host"), annotations: { readOnlyHint: false, untrustedContentHint: false } }, { signal: lifecycle.signal })).catch(() => undefined);
      void Promise.resolve(context.registerTool({ name: "start_joining_quiz", title: "Join a quiz", description: "Open the player join flow using a six-digit Quizloom room code.", inputSchema: { type: "object", properties: { code: { type: "string", pattern: "^[0-9]{6}$" } }, required: ["code"], additionalProperties: false }, execute: (input) => { const code = (input as { code?: string }).code; if (!code || !/^\d{6}$/.test(code)) throw new Error("A valid six-digit code is required"); return navigate(`/join?code=${code}`); }, annotations: { readOnlyHint: false, untrustedContentHint: false } }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* Unsupported implementations should not affect the app. */ }
    return () => lifecycle.abort();
  }, []);
  return null;
}
