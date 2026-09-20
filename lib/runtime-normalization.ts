import { defaultAvatar } from "@/lib/avatar-defaults";
import type { AvatarCharacter, AvatarConfig, PlayerView } from "@/lib/types";

const bases = new Set<AvatarConfig["base"]>(["round", "bean", "bot"]);
const eyes = new Set<AvatarConfig["eyes"]>(["dot", "happy", "wink"]);
const heads = new Set<AvatarConfig["head"]>(["none", "cap", "sprout", "crown"]);
const accessories = new Set<AvatarConfig["accessory"]>(["none", "glasses", "stars", "bow"]);
const characters = new Set<AvatarCharacter>([
  "custom", "cat", "dog", "panda", "fox", "frog", "bear", "rabbit", "tiger",
  "lion", "elephant", "penguin", "owl", "wolf", "koala", "red-panda", "shark", "dinosaur",
  "cartoon-kid", "hero", "geek", "ninja", "pirate", "explorer", "wizard",
  "astronaut", "knight", "robot", "alien", "monster", "dragon", "superhero"
]);
const colorPattern = /^#[0-9a-f]{6}$/i;

function fallbackAvatar(): AvatarConfig {
  return { ...defaultAvatar, character: "custom" };
}

/** Converts database, network, legacy, or partially corrupt avatar data into a render-safe value. */
export function normalizeAvatarConfig(value: unknown): AvatarConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallbackAvatar();
  const candidate = value as Record<string, unknown>;
  if (
    !bases.has(candidate.base as AvatarConfig["base"]) ||
    typeof candidate.skin !== "string" || !colorPattern.test(candidate.skin) ||
    !eyes.has(candidate.eyes as AvatarConfig["eyes"]) ||
    !heads.has(candidate.head as AvatarConfig["head"]) ||
    !accessories.has(candidate.accessory as AvatarConfig["accessory"]) ||
    typeof candidate.accent !== "string" || !colorPattern.test(candidate.accent) ||
    (candidate.character !== undefined && !characters.has(candidate.character as AvatarCharacter))
  ) return fallbackAvatar();

  return {
    base: candidate.base as AvatarConfig["base"],
    skin: candidate.skin,
    eyes: candidate.eyes as AvatarConfig["eyes"],
    head: candidate.head as AvatarConfig["head"],
    accessory: candidate.accessory as AvatarConfig["accessory"],
    accent: candidate.accent,
    character: (candidate.character as AvatarCharacter | undefined) ?? "custom"
  };
}

export function toSafeCount(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

function toSafeNullableCount(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

/** Normalizes one player independently so a bad realtime row cannot poison the full room render. */
export function normalizePlayerView(value: unknown, existing?: PlayerView): PlayerView {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const nickname = typeof row.nickname === "string" && row.nickname.trim() ? row.nickname : existing?.nickname ?? "Player";
  const avatarSource = row.avatar_config ?? row.avatar ?? existing?.avatar;
  return {
    id: typeof row.id === "string" ? row.id : existing?.id ?? "",
    nickname,
    avatar: normalizeAvatarConfig(avatarSource),
    score: toSafeCount(row.score, existing?.score ?? 0),
    correctAnswers: toSafeCount(row.correct_answers ?? row.correctAnswers, existing?.correctAnswers ?? 0),
    streak: toSafeCount(row.streak, existing?.streak ?? 0),
    correctResponseTimeMs: toSafeNullableCount(row.correct_response_time_ms ?? row.correctResponseTimeMs, existing?.correctResponseTimeMs ?? null),
    speedRankingEnabled: typeof row.speedRankingEnabled === "boolean" ? row.speedRankingEnabled : existing?.speedRankingEnabled ?? false
  };
}
