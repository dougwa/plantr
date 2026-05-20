import type { FastifyPluginAsync } from "fastify";
import { Prisma, type TagKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { rejectIfReadOnly } from "../lib/site-access.js";

const createSchema = z.object({
  name: z.string().min(1).max(64),
});

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
});

export type PublicTag = {
  id: string;
  name: string;
  kind: TagKind;
  locationShapeId: string | null;
};

export function publicTag(t: {
  id: string;
  name: string;
  kind: TagKind;
  locationShapeId: string | null;
}): PublicTag {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    locationShapeId: t.locationShapeId,
  };
}

export const tagRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tags", async (req) => {
    const tags = await prisma.tag.findMany({
      where: { siteId: req.site!.id },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
    return { tags: tags.map(publicTag) };
  });

  app.post("/tags", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const t = await prisma.tag
      .create({
        data: { name: parsed.data.name, kind: "custom", siteId: req.site!.id },
      })
      .catch((err: { code?: string }) => {
        if (err.code === "P2002") return null;
        throw err;
      });
    if (!t) return reply.code(409).send({ error: "duplicate_name" });
    return { tag: publicTag(t) };
  });

  app.patch<{ Params: { id: string } }>("/tags/:id", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const existing = await prisma.tag.findFirst({
      where: { id: req.params.id, siteId: req.site!.id },
      select: { kind: true },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.kind !== "custom") {
      return reply.code(409).send({ error: "managed_by_location" });
    }
    try {
      const t = await prisma.tag.update({
        where: { id: req.params.id },
        data: parsed.data,
      });
      return { tag: publicTag(t) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          return reply.code(409).send({ error: "duplicate_name" });
        }
        if (err.code === "P2025") {
          return reply.code(404).send({ error: "not_found" });
        }
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/tags/:id", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const existing = await prisma.tag.findFirst({
      where: { id: req.params.id, siteId: req.site!.id },
      select: { kind: true },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.kind !== "custom") {
      return reply.code(409).send({ error: "managed_by_location" });
    }
    await prisma.tag.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
};
