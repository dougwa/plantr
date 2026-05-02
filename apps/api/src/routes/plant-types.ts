import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const createSchema = z.object({ name: z.string().min(1).max(64) });

export const plantTypeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/plant-types", { onRequest: [app.requireAuth] }, async () => {
    const types = await prisma.plantType.findMany({ orderBy: { name: "asc" } });
    return { types: types.map((t) => ({ id: t.id, name: t.name })) };
  });

  app.post("/plant-types", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const t = await prisma.plantType
      .create({ data: { name: parsed.data.name } })
      .catch((err: { code?: string }) => {
        if (err.code === "P2002") return null;
        throw err;
      });
    if (!t) return reply.code(409).send({ error: "duplicate_name" });
    return { type: { id: t.id, name: t.name } };
  });
};
