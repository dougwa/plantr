import type { FastifyPluginAsync } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../db.js";
import { SESSION_COOKIE, generateToken, sessionExpiry } from "./tokens.js";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const { username, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const token = generateToken();
    const expiresAt = sessionExpiry();
    await prisma.session.create({
      data: { token, userId: user.id, expiresAt },
    });

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        mustChangePass: user.mustChangePass,
      },
    };
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
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const passwordHash = await argon2.hash(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePass: false },
    });

    return { ok: true };
  });
};
