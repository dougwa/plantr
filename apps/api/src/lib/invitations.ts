import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 24;
const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;

export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function defaultInvitationExpiry(): Date {
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

export function isExpired(at: Date | null | undefined): boolean {
  if (!at) return false;
  return at.getTime() < Date.now();
}
