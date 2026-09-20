import { Crown, Medal } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { PlayerView } from "@/lib/types";
import { normalizePlayerView } from "@/lib/runtime-normalization";
import { rankPlayers as sortPlayers } from "@/lib/player-ranking";

export function rankPlayers(players: PlayerView[]) {
  return sortPlayers((Array.isArray(players) ? players : []).map(player => normalizePlayerView(player)));
}

export function Leaderboard({ players, meId, compact = false, skip = 0 }: { players: PlayerView[]; meId?: string; compact?: boolean; skip?: number }) {
  const sorted = rankPlayers(players).slice(skip);
  return <div className="space-y-2">{sorted.map((player, index) => <div key={player.id} className={`flex animate-pop items-center gap-3 rounded-2xl border-2 p-3 transition-all ${player.id === meId ? "border-blue bg-blue/5" : "border-ink/10 bg-white"}`}>
    <span className="w-8 text-center font-[family-name:var(--font-display)] text-xl font-bold">{index + skip + 1}</span><Avatar config={player.avatar} size={compact ? 42 : 50}/><div className="min-w-0 flex-1"><p className="truncate font-bold">{player.nickname}{player.id === meId && <span className="ml-2 text-xs text-blue">YOU</span>}</p>{!compact && <p className="text-sm text-ink/50">{player.correctAnswers} correct · {player.streak} streak</p>}</div><span className="font-[family-name:var(--font-display)] text-lg font-bold">{player.score.toLocaleString()}</span>
  </div>)}</div>;
}

const podiumStyles = {
  1: { height: "h-48 sm:h-52", background: "from-[#F7C948] to-[#D99A12]", ring: "ring-[#F7C948]", label: "Gold", icon: Crown },
  2: { height: "h-36 sm:h-40", background: "from-[#C8D0DA] to-[#8996A7]", ring: "ring-[#AAB5C2]", label: "Silver", icon: Medal },
  3: { height: "h-28 sm:h-32", background: "from-[#D68A55] to-[#A9572D]", ring: "ring-[#C27343]", label: "Bronze", icon: Medal }
} as const;

export function Podium({ players }: { players: PlayerView[] }) {
  const top = rankPlayers(players).slice(0, 3); const order = [top[1], top[0], top[2]];
  return <div><div className="mt-8 grid min-h-80 grid-cols-3 items-end gap-2 sm:gap-5">{order.map((player, index) => {
    if (!player) return <div key={index}/>;
    const place = (index === 1 ? 1 : index === 0 ? 2 : 3) as 1 | 2 | 3; const style = podiumStyles[place]; const Icon = style.icon;
    return <div key={player.id} className="flex min-w-0 flex-col items-center"><div className="relative"><Avatar config={player.avatar} size={place === 1 ? 88 : 68} className={`ring-4 ${style.ring}`}/>{place === 1 && <Crown aria-hidden className="absolute -top-7 left-1/2 -translate-x-1/2 rotate-[-8deg] fill-[#F7C948] text-[#B87900]" size={32}/>}</div><p className="mt-3 max-w-full truncate px-1 font-bold">{player.nickname}</p><p className="text-sm font-bold text-ink/55">{player.score.toLocaleString()} pts</p><div className={`mt-3 flex w-full flex-col items-center rounded-t-3xl bg-gradient-to-b p-3 text-white shadow-[inset_0_2px_0_rgba(255,255,255,.35)] ${style.height} ${style.background}`}><Icon aria-hidden className="mb-1" size={place === 1 ? 30 : 24}/><span className="font-[family-name:var(--font-display)] text-4xl font-bold">{place}</span><span className="mt-1 text-xs font-extrabold uppercase tracking-[.14em] opacity-90">{style.label}</span></div></div>;
  })}</div><p className="mt-3 text-xs font-semibold text-ink/45">{players.some(player => player.speedRankingEnabled) ? "Equal scores are ordered by fastest cumulative correct-answer time, then player name." : "Ties are ordered by correct answers, then player name."}</p></div>;
}
