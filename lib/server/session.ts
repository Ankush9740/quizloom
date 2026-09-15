import { createHash, randomBytes } from "node:crypto";

export function createSessionToken() { return randomBytes(32).toString("base64url"); }
export function hashToken(token: string) {
  const pepper = process.env.SESSION_TOKEN_PEPPER;
  if (!pepper) throw new Error("SESSION_TOKEN_PEPPER is not configured");
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}
export function safeEqualHash(rawToken: string | null, storedHash: string | null) {
  return Boolean(rawToken && storedHash && hashToken(rawToken) === storedHash);
}
