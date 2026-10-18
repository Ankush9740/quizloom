export type PresenceRole = "host" | "player";

type PresenceEntry = { role?: unknown; playerId?: unknown };

export function derivePresenceState(state: Record<string, PresenceEntry[]>, role: PresenceRole) {
  const onlineIds = new Set<string>();

  if (role === "player") {
    for (const entries of Object.values(state)) {
      if (entries.some(entry => entry.role === "host")) return { onlineIds, hostOnline: true };
    }
    return { onlineIds, hostOnline: false };
  }

  let hostOnline = false;
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      if (entry.role === "host") hostOnline = true;
      if (entry.role === "player" && typeof entry.playerId === "string") {
        onlineIds.add(entry.playerId);
      }
    }
  }

  return { onlineIds, hostOnline };
}

export function equalStringSets(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
