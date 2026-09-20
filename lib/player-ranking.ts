import type { PlayerView } from "@/lib/types";

function compareStableText(a: string, b: string) {
  const normalizedA = a.normalize("NFKC").toLocaleLowerCase("en-US");
  const normalizedB = b.normalize("NFKC").toLocaleLowerCase("en-US");
  if (normalizedA < normalizedB) return -1;
  if (normalizedA > normalizedB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function comparePlayerRank(a: PlayerView, b: PlayerView) {
  const scoreDifference = b.score - a.score;
  if (scoreDifference) return scoreDifference;

  if (a.speedRankingEnabled && b.speedRankingEnabled) {
    const aTime = a.correctAnswers > 0 ? a.correctResponseTimeMs : null;
    const bTime = b.correctAnswers > 0 ? b.correctResponseTimeMs : null;
    if (aTime !== null || bTime !== null) {
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      if (aTime !== bTime) return aTime - bTime;
    }
  } else {
    const correctDifference = b.correctAnswers - a.correctAnswers;
    if (correctDifference) return correctDifference;
  }

  return compareStableText(a.nickname, b.nickname) || compareStableText(a.id, b.id);
}

export function rankPlayers(players: PlayerView[]) {
  return [...players].sort(comparePlayerRank);
}
