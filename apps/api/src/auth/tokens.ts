import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export const SESSION_COOKIE = "plantr_session";
