import { z } from "zod";

export const roomCodeSchema = z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit code");
export const nicknameSchema = z.string().trim().min(2, "Use at least 2 characters").max(18, "Keep it under 18 characters").regex(/^[^\u0000-\u001f\u007f<>]+$/, "Please remove symbols like < or >");
export const avatarSchema = z.object({
  base: z.enum(["round", "bean", "bot"]), skin: z.string().regex(/^#[0-9a-f]{6}$/i),
  eyes: z.enum(["dot", "happy", "wink"]), head: z.enum(["none", "cap", "sprout", "crown"]),
  accessory: z.enum(["none", "glasses", "stars", "bow"]), accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  character: z.enum(["custom", "cat", "dog", "panda", "fox", "frog", "bear", "rabbit", "tiger", "lion", "elephant", "penguin", "owl", "wolf", "koala", "red-panda", "shark", "dinosaur", "cartoon-kid", "hero", "geek", "ninja", "pirate", "explorer", "astronaut", "wizard", "knight", "robot", "alien", "monster", "dragon", "superhero"]).optional()
});
export const questionSchema = z.object({
  prompt: z.string().trim().min(5).max(240), timeLimit: z.number().int().min(5).max(300),
  options: z.tuple([z.string().trim().min(1).max(120), z.string().trim().min(1).max(120), z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)]),
  correctIndex: z.number().int().min(0).max(3)
});
export const quizSchema = z.object({ title: z.string().trim().min(3).max(80), pointsPerCorrectAnswer: z.number().int().min(1).max(1000).default(1), questions: z.array(questionSchema).min(1).max(50) });

export const portableQuestionSchema = z.object({
  question: z.string().trim().min(5, "Each question needs at least 5 characters").max(240),
  options: z.tuple([
    z.string().trim().min(1).max(120), z.string().trim().min(1).max(120),
    z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)
  ]),
  correctAnswer: z.number().int().min(0).max(3),
  timeLimit: z.number().int().min(5, "Question timers must be at least 5 seconds").max(300, "Question timers cannot exceed 300 seconds")
}).strict();

export const portableQuizSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().trim().min(3, "Quiz title needs at least 3 characters").max(80),
  description: z.string().trim().max(300).default(""),
  pointsPerCorrectAnswer: z.number().int().min(1, "Points must be at least 1").max(1000, "Points cannot exceed 1,000").default(1),
  questions: z.array(portableQuestionSchema).min(1, "Add at least one question").max(50, "A quiz can contain at most 50 questions")
}).strict();

export function messageFrom(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Please check your details";
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
