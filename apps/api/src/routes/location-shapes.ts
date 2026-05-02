import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { pointInShape } from "../lib/geo.js";

const createSchema = z.object({
  name: z.string().max(64).nullable().optional(),
  kind: z.enum(["rectangle", "ellipse"]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be #rrggbb"),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  widthMeters: z.number().positive().max(10_000),
  heightMeters: z.number().positive().max(10_000),
  rotationDegrees: z.number().min(-360).max(360).optional(),
  locked: z.boolean().optional(),
});

const patchSchema = createSchema.partial();

function toPublic(s: {
  id: string;
  name: string | null;
  kind: string;
  color: string;
  centerLat: number;
  centerLng: number;
  widthMeters: number;
  heightMeters: number;
  rotationDegrees: number;
  locked: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    color: s.color,
    centerLat: s.centerLat,
    centerLng: s.centerLng,
    widthMeters: s.widthMeters,
    heightMeters: s.heightMeters,
    rotationDegrees: s.rotationDegrees,
    locked: s.locked,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function reassignPlantsForShape(shapeId: string) {
  // Re-evaluate every plant that has GPS and either belongs to this shape or
  // doesn't yet belong to any shape, in case the change pulled them in/out.
  const candidates = await prisma.plant.findMany({
    where: {
      gpsLat: { not: null },
      gpsLng: { not: null },
      OR: [{ locationShapeId: null }, { locationShapeId: shapeId }],
    },
    select: { id: true, gpsLat: true, gpsLng: true },
  });
  if (candidates.length === 0) return;

  const shapes = await prisma.locationShape.findMany();
  await Promise.all(
    candidates.map(async (p) => {
      const containing = shapes.find((s) => pointInShape(p.gpsLat!, p.gpsLng!, s));
      const next = containing ? containing.id : null;
      await prisma.plant.update({
        where: { id: p.id },
        data: { locationShapeId: next },
      });
    }),
  );
}

export const locationShapeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/location-shapes", { onRequest: [app.requireAuth] }, async () => {
    const shapes = await prisma.locationShape.findMany({ orderBy: { createdAt: "asc" } });
    return { shapes: shapes.map(toPublic) };
  });

  app.post("/location-shapes", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const shape = await prisma.locationShape.create({
      data: {
        name: data.name ?? null,
        kind: data.kind,
        color: data.color,
        centerLat: data.centerLat,
        centerLng: data.centerLng,
        widthMeters: data.widthMeters,
        heightMeters: data.heightMeters,
        rotationDegrees: data.rotationDegrees ?? 0,
        locked: data.locked ?? false,
        createdById: req.user!.id,
      },
    });
    await reassignPlantsForShape(shape.id);
    return reply.code(201).send({ shape: toPublic(shape) });
  });

  app.patch<{ Params: { id: string } }>(
    "/location-shapes/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const updated = await prisma.locationShape
        .update({ where: { id: req.params.id }, data: parsed.data })
        .catch((err: { code?: string }) => {
          if (err.code === "P2025") return null;
          throw err;
        });
      if (!updated) return reply.code(404).send({ error: "not_found" });
      await reassignPlantsForShape(updated.id);
      return { shape: toPublic(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/location-shapes/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const result = await prisma.locationShape
        .delete({ where: { id: req.params.id } })
        .catch((err: { code?: string }) => {
          if (err.code === "P2025") return null;
          throw err;
        });
      if (!result) return reply.code(404).send({ error: "not_found" });
      // Schema sets locationShapeId on plants to null on delete (onDelete: SetNull).
      return { ok: true };
    },
  );
};
