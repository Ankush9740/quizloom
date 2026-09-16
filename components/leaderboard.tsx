import { Avatar } from "@/components/avatar";
import type { PlayerView } from "@/lib/types";
import { normalizePlayerView } from "@/lib/runtime-normalization";

export function Leaderboard({ players, meId, compact = false }: { players: PlayerView[]; meId?: string; compact?: boolean }) {
  const sorted = (Array.isArray(players) ? players : []).map(player => normalizePlayerView(player)).sort((a,b) => b.score - a.score);
  return <div className="space-y-2">{sorted.map((player, index) => <div key={player.id} className={`flex animate-pop items-center gap-3 rounded-2xl border-2 p-3 transition-all ${player.id === meId ? "border-blue bg-blue/5" : "border-ink/10 bg-white"}`}>
    <span className="w-8 text-center font-[family-name:var(--font-display)] text-xl font-bold">{index + 1}</span><Avatar config={player.avatar} size={compact ? 42 : 50}/><div className="min-w-0 flex-1"><p className="truncate font-bold">{player.nickname}{player.id === meId && <span className="ml-2 text-xs text-blue">YOU</span>}</p>{!compact && <p className="text-sm text-ink/50">{player.correctAnswers} correct · {player.streak} streak</p>}</div><span className="font-[family-name:var(--font-display)] text-lg font-bold">{player.score.toLocaleString()}</span>
  </div>)}</div>;
}

export function Podium({ players }: { players: PlayerView[] }) {
  const top = (Array.isArray(players) ? players : []).map(player => normalizePlayerView(player)).sort((a,b) => b.score - a.score).slice(0,3); const order = [top[1], top[0], top[2]];
  return <div className="grid h-72 grid-cols-3 items-end gap-2 sm:gap-4">{order.map((p, i) => { if (!p) return <div key={i}/>; const place = i === 1 ? 1 : i === 0 ? 2 : 3; const height = place === 1 ? "h-44" : place === 2 ? "h-32" : "h-24"; return <div key={p.id} className="flex min-w-0 flex-col items-center"><Avatar config={p.avatar} size={place === 1 ? 78 : 62} className="mb-2"/><p className="max-w-full truncate text-sm font-bold">{p.nickname}</p><div className={`mt-2 flex w-full flex-col items-center justify-start rounded-t-3xl p-3 text-white ${height} ${place === 1 ? "bg-blue" : place === 2 ? "bg-coral" : "bg-mint"}`}><span className="font-[family-name:var(--font-display)] text-3xl font-bold">{place}</span><span className="text-xs font-bold opacity-80">{p.score}</span></div></div>; })}</div>;
}
