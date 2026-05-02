import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publicAction } from "../lib/serializers.js";

const actionKindSchema = z.enum(["feeding", "watering", "fertilizing", "treating"]);

const createSchema = z.object({
  kind: actionKindSchema,
  notes: z.string().max(2000).nullable().optional(),
  takenAt: z.string().datetime().optional(),
});

export const actionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>(
    "/plants/:id/actions",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", details: parsed.error.flatten() });
      }

      const plant = await prisma.plant.findUnique({ where: { id: req.params.id } });
      if (!plant) return reply.code(404).send({ error: "not_found" });

      const takenAt = parsed.data.takenAt ? new Date(parsed.data.takenAt) : new Date();
      const action = await prisma.action.create({
        data: {
          plantId: plant.id,
          kind: parsed.data.kind,
          notes: parsed.data.notes ?? null,
          takenAt,
          createdById: req.user!.id,
        },
        include: { createdBy: { select: { id: true, username: true } } },
      });

      return reply.code(201).send({ action: publicAction(action) });
    },
  );
};
