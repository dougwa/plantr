import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publicAction } from "../lib/serializers.js";
import { rejectIfReadOnly } from "../lib/site-access.js";

const actionKindSchema = z.enum(["feeding", "watering", "fertilizing", "treating"]);

const createSchema = z.object({
  kind: actionKindSchema,
  notes: z.string().max(2000).nullable().optional(),
  takenAt: z.string().datetime().optional(),
});

const patchSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

export const actionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>(
    "/plants/:id/actions",
    async (req, reply) => {
      if (rejectIfReadOnly(req, reply)) return;
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", details: parsed.error.flatten() });
      }

      const plant = await prisma.plant.findFirst({
        where: { id: req.params.id, siteId: req.site!.id },
      });
      if (!plant) return reply.code(404).send({ error: "not_found" });

      const takenAt = parsed.data.takenAt ? new Date(parsed.data.takenAt) : new Date();
      const action = await prisma.action.create({
        data: {
          plantId: plant.id,
          kind: parsed.data.kind,
          notes: parsed.data.notes ?? null,
          takenAt,
          siteId: req.site!.id,
          createdById: req.user!.id,
        },
        include: { createdBy: { select: { id: true, username: true } } },
      });

      return reply.code(201).send({ action: publicAction(action) });
    },
  );

  app.patch<{ Params: { id: string } }>("/actions/:id", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const action = await prisma.action.findFirst({
      where: { id: req.params.id, siteId: req.site!.id },
      select: { id: true },
    });
    if (!action) return reply.code(404).send({ error: "not_found" });

    const updated = await prisma.action.update({
      where: { id: req.params.id },
      data: parsed.data,
      include: { createdBy: { select: { id: true, username: true } } },
    });
    return { action: publicAction(updated) };
  });

  app.delete<{ Params: { id: string } }>("/actions/:id", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const action = await prisma.action.findFirst({
      where: { id: req.params.id, siteId: req.site!.id },
      select: { id: true },
    });
    if (!action) return reply.code(404).send({ error: "not_found" });
    await prisma.action.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
};
