export const avatarBackgroundPalette = [
  "#3155E7", "#C2415C", "#16866A", "#6842C2", "#A8326D", "#196C8C",
  "#B45309", "#475569", "#0F766E", "#7C3AED", "#BE123C", "#0369A1"
] as const;

/** Mirrors migration 009's deterministic, per-character assignment policy. */
export function chooseAvatarBackground(requested: string, usedForCharacter: Iterable<string>) {
  const used = new Set(Array.from(usedForCharacter, color => color.toUpperCase()));
  if (used.size === 0) return requested;
  const available = avatarBackgroundPalette.find(color => !used.has(color.toUpperCase()));
  if (available) return available;
  return avatarBackgroundPalette[used.size % avatarBackgroundPalette.length];
}
