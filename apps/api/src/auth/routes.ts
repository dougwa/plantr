import type { FastifyPluginAsync, FastifyReply } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { OAuthProvider, Prisma, type User } from "@prisma/client";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { SESSION_COOKIE, generateToken, sessionExpiry } from "./tokens.js";
import { deriveMustCompleteProfile, type AuthUser } from "./plugin.js";
import { verifyAppleIdToken, verifyGoogleIdToken, type OAuthIdentity } from "./oauth.js";
import { dispatch } from "../lib/notifications.js";
import { isExpired } from "../lib/invitations.js";

const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

// Lowercased email. We don't enforce a strict RFC pattern — Postgres unique
// index does the real work — but reject obvious garbage.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "invalid_email");

const passwordField = z.string().min(8).max(256);
const nameField = z.string().trim().min(1).max(120);

const loginSchema = z
  .object({
    // Phase 2 prefers email; we still accept the legacy `username` field so
    // older clients keep working until they update.
    email: emailField.optional(),
    username: z.string().min(1).max(254).optional(),
    password: z.string().min(1).max(256),
  })
  .refine((v) => !!v.email || !!v.username, { message: "missing_identifier" });

const signupSchema = z.object({
  email: emailField,
  password: passwordField,
  name: nameField.optional(),
});

const oauthAppleSchema = z.object({
  identityToken: z.string().min(1).max(8192),
  // Apple only returns the name on the very first sign-in, and only when the
  // client passes it back. We accept and persist it if present.
  fullName: z
    .object({
      givenName: z.string().nullable().optional(),
      familyName: z.string().nullable().optional(),
    })
    .optional(),
});

const oauthGoogleSchema = z.object({
  idToken: z.string().min(1).max(8192),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordField,
});

const completeProfileSchema = z.object({
  email: emailField,
  name: nameField.optional(),
  // Optional — if provided alongside an admin@local migration we set a real
  // password at the same time.
  newPassword: passwordField.optional(),
});

function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    mustChangePass: u.mustChangePass,
    mustCompleteProfile: deriveMustCompleteProfile(u),
  };
}

/**
 * When a user first lands with a verified email — fresh signup, OAuth, or
 * completing their profile — surface any pending invitations sent to that
 * email as in-app notifications. The invitation rows themselves are not
 * mutated; the user still needs to explicitly accept.
 */
async function surfacePendingInvitations(
  userId: string,
  email: string | null,
  log: import("fastify").FastifyBaseLogger,
): Promise<void> {
  if (!email) return;
  const pending = await prisma.invitation.findMany({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
    include: {
      site: { select: { name: true } },
      invitedBy: { select: { name: true, username: true } },
    },
  });
  for (const inv of pending) {
    const inviter = inv.invitedBy.name ?? inv.invitedBy.username;
    await dispatch(
      {
        kind: "invitation_received",
        data: {
          invitationId: inv.id,
          siteId: inv.siteId,
          siteName: inv.site.name,
          role: inv.role,
          token: inv.token,
          inviterName: inviter,
        },
        to: { userId },
        subject: `${inviter} invited you to join ${inv.site.name} on PlantR`,
        body: `Open Notifications in PlantR to accept the invitation to ${inv.site.name}.`,
      },
      log,
    );
  }
}

async function createSession(userId: string, reply: FastifyReply): Promise<string> {
  const token = generateToken();
  const expiresAt = sessionExpiry();
  await prisma.session.create({ data: { token, userId, expiresAt } });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return token;
}

/**
 * Pick a username for a new user from their email. Username is still a
 * NOT NULL unique column on User — we just key it off email so new accounts
 * never collide. If a collision sneaks in (case: someone signed up by email
 * matching another user's legacy username), append a short random suffix.
 */
async function allocateUsername(email: string): Promise<string> {
  const base = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { username: base } });
  if (!existing) return base;
  // Random 4-char suffix on collision; cheap to retry.
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}+${Math.random().toString(36).slice(2, 6)}`;
    const conflict = await prisma.user.findUnique({ where: { username: candidate } });
    if (!conflict) return candidate;
  }
  throw new Error("username_allocation_failed");
}

/**
 * Find or create a User for an OAuth identity. The decision tree:
 *   1. (provider, providerAccountId) → existing linked user.
 *   2. else: if identity.email matches a User.email, link a new OAuthAccount
 *      to that user. (Trusts the provider's verified email; we require
 *      emailVerified=true for this branch.)
 *   3. else: create a new User from scratch.
 */
async function resolveOAuthUser(
  provider: OAuthProvider,
  identity: OAuthIdentity,
  fallbackName: string | null,
): Promise<User> {
  // 1. Linked account
  const linked = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: identity.providerAccountId,
      },
    },
    include: { user: true },
  });
  if (linked) return linked.user;

  // 2. Existing user with the same verified email
  if (identity.email && identity.emailVerified) {
    const existing = await prisma.user.findUnique({ where: { email: identity.email } });
    if (existing) {
      await prisma.oAuthAccount.create({
        data: {
          userId: existing.id,
          provider,
          providerAccountId: identity.providerAccountId,
        },
      });
      return existing;
    }
  }

  // 3. Brand new user. Email may be null (Apple "hide my email" relay path
  // returns a relay address but it's still an email) — we only branch on it
  // for username allocation.
  const usernameSeed = identity.email ?? `${provider.toLowerCase()}_${identity.providerAccountId}`;
  const username = await allocateUsername(usernameSeed);
  const created = await prisma.user.create({
    data: {
      username,
      email: identity.email,
      name: identity.name ?? fallbackName,
      passwordHash: null,
      oauthAccounts: {
        create: {
          provider,
          providerAccountId: identity.providerAccountId,
        },
      },
    },
  });
  return created;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const { email, username, password } = parsed.data;
    const user = email
      ? await prisma.user.findUnique({ where: { email } })
      : await prisma.user.findUnique({ where: { username: username! } });
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    const token = await createSession(user.id, reply);
    return { token, user: toAuthUser(user) };
  });

  app.post("/auth/signup", async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }
    const { email, password, name } = parsed.data;

    const username = await allocateUsername(email);
    const passwordHash = await argon2.hash(password);
    let user: User;
    try {
      user = await prisma.user.create({
        data: { username, email, name: name ?? null, passwordHash },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw err;
    }

    await surfacePendingInvitations(user.id, user.email, req.log);
    const token = await createSession(user.id, reply);
    return { token, user: toAuthUser(user) };
  });

  app.post("/auth/oauth/apple", async (req, reply) => {
    const parsed = oauthAppleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (env.APPLE_CLIENT_IDS.length === 0) {
      return reply.code(503).send({ error: "apple_oauth_not_configured" });
    }

    let identity: OAuthIdentity;
    try {
      identity = await verifyAppleIdToken(parsed.data.identityToken, env.APPLE_CLIENT_IDS);
    } catch (err) {
      req.log.warn({ err }, "apple identityToken verification failed");
      return reply.code(401).send({ error: "invalid_apple_token" });
    }

    const fullName = parsed.data.fullName;
    const composedName = fullName
      ? [fullName.givenName, fullName.familyName].filter(Boolean).join(" ").trim() || null
      : null;

    const user = await resolveOAuthUser(OAuthProvider.APPLE, identity, composedName);
    await surfacePendingInvitations(user.id, user.email, req.log);
    const token = await createSession(user.id, reply);
    return { token, user: toAuthUser(user) };
  });

  app.post("/auth/oauth/google", async (req, reply) => {
    const parsed = oauthGoogleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (env.GOOGLE_CLIENT_IDS.length === 0) {
      return reply.code(503).send({ error: "google_oauth_not_configured" });
    }

    let identity: OAuthIdentity;
    try {
      identity = await verifyGoogleIdToken(parsed.data.idToken, env.GOOGLE_CLIENT_IDS);
    } catch (err) {
      req.log.warn({ err }, "google idToken verification failed");
      return reply.code(401).send({ error: "invalid_google_token" });
    }

    const user = await resolveOAuthUser(OAuthProvider.GOOGLE, identity, identity.name);
    await surfacePendingInvitations(user.id, user.email, req.log);
    const token = await createSession(user.id, reply);
    return { token, user: toAuthUser(user) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : null;
    const token = bearer ?? req.cookies?.[SESSION_COOKIE] ?? null;
    if (token) {
      await prisma.session.deleteMany({ where: { token } });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { onRequest: [app.requireAuth] }, async (req) => {
    return { user: req.user };
  });

  app.post("/auth/change-password", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }
    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
      return reply.code(400).send({ error: "new_password_must_differ" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    const passwordHash = await argon2.hash(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePass: false },
    });

    return { ok: true };
  });

  app.post("/auth/complete-profile", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const parsed = completeProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }
    const { email, name, newPassword } = parsed.data;

    const data: Prisma.UserUpdateInput = { email };
    if (name) data.name = name;
    if (newPassword) {
      data.passwordHash = await argon2.hash(newPassword);
      data.mustChangePass = false;
    }

    let updated: User;
    try {
      updated = await prisma.user.update({
        where: { id: req.user!.id },
        data,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw err;
    }
    await surfacePendingInvitations(updated.id, updated.email, req.log);
    return { user: toAuthUser(updated) };
  });
};
