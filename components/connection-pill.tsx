import { WifiOff } from "lucide-react";
export function ConnectionPill({ connected }: { connected: boolean }) { return connected ? null : <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white shadow-card"><WifiOff size={16}/> Reconnecting…</div>; }
