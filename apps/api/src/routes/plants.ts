import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { pointInShape } from "../lib/geo.js";
import { PLANT_INCLUDE, publicPlant } from "../lib/serializers.js";

const qrCodeSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

const createSchema = z.object({
  qrCode: qrCodeSchema,
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
});

const patchSchema = z.object({
  name: z.string().max(128).nullable().optional(),
  typeId: z.string().nullable().optional(),
  species: z.string().max(128).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  gpsLat: z.number().min(-90).max(90).nullable().optional(),
  gpsLng: z.number().min(-180).max(180).nullable().optional(),
  locationShapeId: z.string().nullable().optional(),
});

async function resolveShapeForPoint(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return null;
  const shapes = await prisma.locationShape.findMany();
  const containing = shapes.find((s) => pointInShape(lat, lng, s));
  return containing?.id ?? null;
}

export const plantRoutes: FastifyPluginAsync = async (app) => {
  app.get("/plants", { onRequest: [app.requireAuth] }, async () => {
    const plants = await prisma.plant.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        type: { select: { id: true, name: true } },
        coverPhoto: { select: { id: true } },
      },
    });
    return {
      plants: plants.map((p) => ({
        id: p.id,
        qrCode: p.qrCode,
        name: p.name,
        type: p.type ? { id: p.type.id, name: p.type.name } : null,
        species: p.species,
        gpsLat: p.gpsLat,
        gpsLng: p.gpsLng,
        locationShapeId: p.locationShapeId,
        coverPhotoThumbUrl: p.coverPhoto
          ? `/photos/${p.coverPhoto.id}/file/thumb`
          : null,
      })),
    };
  });

  app.get<{ Params: { code: string } }>(
    "/plants/by-qr/:code",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const code = req.params.code;
      if (!qrCodeSchema.safeParse(code).success) {
        return reply.code(400).send({ error: "invalid_qr_code" });
      }
      const plant = await prisma.plant.findUnique({
        where: { qrCode: code },
        include: PLANT_INCLUDE,
      });
      if (!plant) return reply.code(404).send({ error: "not_found" });
      return { plant: publicPlant(plant) };
    },
  );

  app.post("/plants", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { qrCode, gpsLat, gpsLng } = parsed.data;

    const existing = await prisma.plant.findUnique({ where: { qrCode } });
    if (existing) return reply.code(409).send({ error: "qr_code_taken" });

    const locationShapeId = await resolveShapeForPoint(gpsLat ?? null, gpsLng ?? null);

    const plant = await prisma.plant.create({
      data: {
        qrCode,
        gpsLat: gpsLat ?? null,
        gpsLng: gpsLng ?? null,
        locationShapeId,
        createdById: req.user!.id,
      },
      include: PLANT_INCLUDE,
    });
    return reply.code(201).send({ plant: publicPlant(plant) });
  });

  app.get<{ Params: { id: string } }>(
    "/plants/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const plant = await prisma.plant.findUnique({
        where: { id: req.params.id },
        include: PLANT_INCLUDE,
      });
      if (!plant) return reply.code(404).send({ error: "not_found" });
      return { plant: publicPlant(plant) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/plants/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", details: parsed.error.flatten() });
      }

      const data = parsed.data;
      if (data.typeId) {
        const exists = await prisma.plantType.findUnique({ where: { id: data.typeId } });
        if (!exists) return reply.code(400).send({ error: "invalid_type_id" });
      }

      // If GPS changed (and locationShapeId not explicitly set), re-resolve the shape.
      if (
        (data.gpsLat !== undefined || data.gpsLng !== undefined) &&
        data.locationShapeId === undefined
      ) {
        const current = await prisma.plant.findUnique({
          where: { id: req.params.id },
          select: { gpsLat: true, gpsLng: true },
        });
        if (current) {
          const lat = data.gpsLat !== undefined ? data.gpsLat : current.gpsLat;
          const lng = data.gpsLng !== undefined ? data.gpsLng : current.gpsLng;
          (data as { locationShapeId?: string | null }).locationShapeId =
            await resolveShapeForPoint(lat, lng);
        }
      }

      const updated = await prisma.plant
        .update({
          where: { id: req.params.id },
          data,
          include: PLANT_INCLUDE,
        })
        .catch((err: { code?: string }) => {
          if (err.code === "P2025") return null;
          throw err;
        });
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return { plant: publicPlant(updated) };
    },
  );
};
