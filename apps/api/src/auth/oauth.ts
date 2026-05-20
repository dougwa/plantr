/**
 * OAuth identity-token verification for Apple and Google.
 *
 * We rely on each provider's published JWKS to validate the JWT signature. The
 * `jose` library caches keys with sensible TTLs so we don't refetch on every
 * request. Issuer + audience checks are enforced inline.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export type OAuthIdentity = {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

function pickString(payload: JWTPayload, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickBoolean(payload: JWTPayload, key: string): boolean {
  const v = payload[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return false;
}

export async function verifyAppleIdToken(
  token: string,
  audiences: string[],
): Promise<OAuthIdentity> {
  if (audiences.length === 0) throw new Error("apple_not_configured");
  const { payload } = await jwtVerify(token, appleJwks, {
    issuer: APPLE_ISSUER,
    audience: audiences,
  });
  const sub = pickString(payload, "sub");
  if (!sub) throw new Error("apple_missing_sub");
  return {
    providerAccountId: sub,
    email: pickString(payload, "email"),
    emailVerified: pickBoolean(payload, "email_verified"),
    name: null,
  };
}

export async function verifyGoogleIdToken(
  token: string,
  audiences: string[],
): Promise<OAuthIdentity> {
  if (audiences.length === 0) throw new Error("google_not_configured");
  const { payload } = await jwtVerify(token, googleJwks, {
    issuer: GOOGLE_ISSUERS,
    audience: audiences,
  });
  const sub = pickString(payload, "sub");
  if (!sub) throw new Error("google_missing_sub");
  return {
    providerAccountId: sub,
    email: pickString(payload, "email"),
    emailVerified: pickBoolean(payload, "email_verified"),
    name: pickString(payload, "name"),
  };
}
