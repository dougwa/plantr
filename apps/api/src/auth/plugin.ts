import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { SESSION_COOKIE } from "./tokens.js";

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  mustChangePass: boolean;
  // True when the user still needs to set a real email — covers the legacy
  // admin account (email=admin@local after backfill) and any user we created
  // without an email. Phase-2 clients route these users to a profile screen.
  mustCompleteProfile: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePasswordChanged: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  return cookieToken ?? null;
}

export function deriveMustCompleteProfile(user: {
  email: string | null;
}): boolean {
  if (!user.email) return true;
  // Backfill placeholder for the seeded admin account.
  if (user.email === "admin@local") return true;
  return false;
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req) => {
    req.user = null;
    const token = extractToken(req);
    if (!token) return;

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!session) return;
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return;
    }

    // Throttle write — only update lastUsedAt once per minute.
    if (Date.now() - session.lastUsedAt.getTime() > 60_000) {
      prisma.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }

    const u = session.user;
    req.user = {
      id: u.id,
      username: u.username,
      email: u.email,
      name: u.name,
      mustChangePass: u.mustChangePass,
      mustCompleteProfile: deriveMustCompleteProfile(u),
    };
  });

  app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.decorate(
    "requirePasswordChanged",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) {
        reply.code(401).send({ error: "unauthorized" });
        return;
      }
      if (req.user.mustChangePass) {
        reply.code(403).send({ error: "password_change_required" });
      }
    },
  );
};

export default fp(authPlugin, { name: "auth" });
