import type { PlayerView, RoomState, RoomTransition } from "./types";

export type PlayerReveal = {
  answered: boolean;
  selectedOptionId: string | null;
  wasCorrect: boolean | null;
  lastPoints: number;
  score: number;
  correctAnswers: number;
  streak: number;
  correctOptionId: string;
};

function currentPlayer(state: RoomState, playerId?: string): PlayerView | undefined {
  return state.me ?? (playerId ? state.players.find(player => player.id === playerId) : undefined);
}

export function applyQuestionTransition(
  previous: RoomState,
  transition: RoomTransition,
  expectedQuestion?: number,
  playerId?: string
): RoomState {
  if (expectedQuestion !== undefined && (
    previous.room.currentQuestion > expectedQuestion ||
    (previous.room.currentQuestion === expectedQuestion && ["results", "finished", "ended"].includes(previous.room.status))
  )) return previous;

  const player = currentPlayer(previous, playerId);
  return {
    ...previous,
    room: { ...previous.room, ...transition.room },
    question: transition.question,
    ...(player ? { me: { ...player, answered: false, lastPoints: 0, selectedOptionId: undefined, wasCorrect: undefined } } : {})
  };
}

export function applyAcceptedAnswer(previous: RoomState, playerId: string, optionId: string, expectedQuestionId?: string): RoomState {
  if (expectedQuestionId && previous.question?.id !== expectedQuestionId) return previous;
  const player = currentPlayer(previous, playerId);
  if (!player) return previous;
  return {
    ...previous,
    me: { ...player, answered: true, lastPoints: previous.me?.lastPoints ?? 0, selectedOptionId: optionId }
  };
}

export function applyPlayerReveal(previous: RoomState, playerId: string, reveal: PlayerReveal): RoomState {
  const player = currentPlayer(previous, playerId);
  if (!previous.question || !player) return previous;
  return {
    ...previous,
    room: { ...previous.room, status: "results" },
    question: { ...previous.question, correctOptionId: reveal.correctOptionId },
    me: {
      ...player,
      answered: reveal.answered,
      selectedOptionId: reveal.selectedOptionId ?? undefined,
      wasCorrect: reveal.wasCorrect ?? undefined,
      lastPoints: reveal.lastPoints,
      score: reveal.score,
      correctAnswers: reveal.correctAnswers,
      streak: reveal.streak
    }
  };
}

export function applyHostRevealState(previous: RoomState, correctOptionId: string, players: PlayerView[]): RoomState {
  if (!previous.question) return previous;
  return {
    ...previous,
    room: { ...previous.room, status: "results" },
    question: { ...previous.question, correctOptionId },
    players
  };
}
