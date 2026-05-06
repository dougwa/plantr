import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be #RRGGBB");

const createSchema = z.object({
  name: z.string().min(1).max(64),
  color: colorSchema,
});

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  color: colorSchema.optional(),
});

function publicTag(t: { id: string; name: string; color: string }) {
  return { id: t.id, name: t.name, color: t.color };
}

export const tagRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tags", { onRequest: [app.requireAuth] }, async () => {
    const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
    return { tags: tags.map(publicTag) };
  });

  app.post("/tags", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const t = await prisma.tag
      .create({ data: { name: parsed.data.name, color: parsed.data.color } })
      .catch((err: { code?: string }) => {
        if (err.code === "P2002") return null;
        throw err;
      });
    if (!t) return reply.code(409).send({ error: "duplicate_name" });
    return { tag: publicTag(t) };
  });

  app.patch<{ Params: { id: string } }>(
    "/tags/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const t = await prisma.tag
        .update({ where: { id: req.params.id }, data: parsed.data })
        .catch((err: { code?: string }) => {
          if (err.code === "P2002") return "duplicate" as const;
          if (err.code === "P2025") return "not_found" as const;
          throw err;
        });
      if (t === "duplicate") return reply.code(409).send({ error: "duplicate_name" });
      if (t === "not_found") return reply.code(404).send({ error: "not_found" });
      return { tag: publicTag(t) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/tags/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const result = await prisma.tag
        .delete({ where: { id: req.params.id } })
        .catch((err: { code?: string }) => {
          if (err.code === "P2025") return null;
          throw err;
        });
      if (!result) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    },
  );
};
