/**
 * In-app notification feed. Notifications carry a free-form `data` payload
 * keyed by `kind`; the client knows how to render each kind. Marking as read
 * is the only mutation — notifications are append-only otherwise.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const markReadSchema = z.object({
  ids: z.array(z.string()).max(200).optional(),
  all: z.boolean().optional(),
});

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/notifications",
    { onRequest: [app.requireAuth] },
    async (req) => {
      const notifications = await prisma.notification.findMany({
        where: { userId: req.user!.id },
        orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
        take: 100,
      });
      return {
        notifications: notifications.map((n) => ({
          id: n.id,
          kind: n.kind,
          data: n.data,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    "/notifications/unread-count",
    { onRequest: [app.requireAuth] },
    async (req) => {
      const count = await prisma.notification.count({
        where: { userId: req.user!.id, readAt: null },
      });
      return { count };
    },
  );

  app.post(
    "/notifications/mark-read",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = markReadSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const { ids, all } = parsed.data;
      if (!all && (!ids || ids.length === 0)) {
        return reply.code(400).send({ error: "nothing_to_mark" });
      }
      const now = new Date();
      const res = await prisma.notification.updateMany({
        where: {
          userId: req.user!.id,
          readAt: null,
          ...(all ? {} : { id: { in: ids! } }),
        },
        data: { readAt: now },
      });
      return { updated: res.count };
    },
  );
};
