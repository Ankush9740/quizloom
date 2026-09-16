export type AvatarCharacter =
  | "custom"
  | "cat" | "dog" | "panda" | "fox" | "frog" | "bear" | "rabbit" | "tiger"
  | "lion" | "elephant" | "penguin" | "owl" | "wolf" | "koala" | "red-panda" | "shark" | "dinosaur"
  | "cartoon-kid" | "hero" | "geek" | "ninja" | "pirate" | "explorer"
  | "astronaut" | "wizard" | "knight" | "robot" | "alien" | "monster" | "dragon" | "superhero";

export type AvatarConfig = {
  base: "round" | "bean" | "bot";
  skin: string;
  eyes: "dot" | "happy" | "wink";
  head: "none" | "cap" | "sprout" | "crown";
  accessory: "none" | "glasses" | "stars" | "bow";
  accent: string;
  /** Missing on avatars saved before character presets were introduced. */
  character?: AvatarCharacter;
};

export type QuizDraftQuestion = {
  prompt: string;
  timeLimit: number;
  options: [string, string, string, string];
  correctIndex: number;
};

export type QuizDocument = {
  version: 1;
  title: string;
  description: string;
  pointsPerCorrectAnswer: number;
  questions: {
    question: string;
    options: [string, string, string, string];
    correctAnswer: number;
    timeLimit: number;
  }[];
};

export type SavedQuizSummary = {
  id: string;
  title: string;
  description: string;
  questionCount: number;
  updatedAt: string;
};

export type PlayerView = {
  id: string;
  nickname: string;
  avatar: AvatarConfig;
  score: number;
  correctAnswers: number;
  streak: number;
};

export type RoomState = {
  room: { id: string; code: string; title: string; status: "lobby" | "question" | "results" | "finished" | "ended"; currentQuestion: number; questionCount: number; questionStartedAt: string | null; questionEndsAt: string | null; answerCount: number };
  players: PlayerView[];
  question?: { id: string; number: number; prompt: string; timeLimit: number; options: { id: string; text: string; position: number }[]; correctOptionId?: string };
  me?: PlayerView & { answered: boolean; lastPoints: number; selectedOptionId?: string; wasCorrect?: boolean };
};
