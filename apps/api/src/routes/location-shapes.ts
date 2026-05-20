import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { qrCodeSchema } from "../lib/qr-code.js";
import { rejectIfReadOnly } from "../lib/site-access.js";
import {
  createLocationTagForShape,
  reassignPlantsAfterShapeChange,
  syncLocationTagName,
} from "../lib/location-tags.js";

const polygonPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const createSchema = z.object({
  name: z.string().max(64).nullable().optional(),
  kind: z.enum(["rectangle", "ellipse", "property", "polygon"]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be #rrggbb"),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  widthMeters: z.number().positive().max(10_000),
  heightMeters: z.number().positive().max(10_000),
  rotationDegrees: z.number().min(-360).max(360).optional(),
  locked: z.boolean().optional(),
  polygonPoints: z.array(polygonPointSchema).min(3).max(256).optional(),
});

// qrCode is settable via PATCH but never updatable once set. Not allowed at
// create time — shapes are drawn on the map first, then later bound to a code
// by scanning.
const patchSchema = createSchema.partial().extend({
  qrCode: qrCodeSchema.optional(),
});

export function toPublicShape(s: {
  id: string;
  qrCode: string | null;
  name: string | null;
  kind: string;
  color: string;
  centerLat: number;
  centerLng: number;
  widthMeters: number;
  heightMeters: number;
  rotationDegrees: number;
  locked: boolean;
  polygonPoints: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    qrCode: s.qrCode,
    name: s.name,
    kind: s.kind,
    color: s.color,
    centerLat: s.centerLat,
    centerLng: s.centerLng,
    widthMeters: s.widthMeters,
    heightMeters: s.heightMeters,
    rotationDegrees: s.rotationDegrees,
    locked: s.locked,
    polygonPoints: s.polygonPoints ?? undefined,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export const locationShapeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/location-shapes", async (req) => {
    const shapes = await prisma.locationShape.findMany({
      where: { siteId: req.site!.id },
      orderBy: { createdAt: "asc" },
    });
    return { shapes: shapes.map(toPublicShape) };
  });

  app.post("/location-shapes", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const siteId = req.site!.id;
    const shape = await prisma.$transaction(async (tx) => {
      const s = await tx.locationShape.create({
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
          polygonPoints: data.polygonPoints ?? undefined,
          siteId,
          createdById: req.user!.id,
        },
      });
      await createLocationTagForShape(tx, s);
      return s;
    });
    await reassignPlantsAfterShapeChange(siteId);
    return reply.code(201).send({ shape: toPublicShape(shape) });
  });

  app.patch<{ Params: { id: string } }>(
    "/location-shapes/:id",
    async (req, reply) => {
      if (rejectIfReadOnly(req, reply)) return;
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const siteId = req.site!.id;
      const data = parsed.data;

      const current = await prisma.locationShape.findFirst({
        where: { id: req.params.id, siteId },
        select: { id: true, qrCode: true },
      });
      if (!current) return reply.code(404).send({ error: "not_found" });

      if (data.qrCode !== undefined) {
        if (current.qrCode !== null) {
          return reply.code(409).send({ error: "qr_code_locked" });
        }
        const taken = await prisma.locationShape.findUnique({
          where: { siteId_qrCode: { siteId, qrCode: data.qrCode } },
          select: { id: true },
        });
        if (taken) return reply.code(409).send({ error: "qr_code_taken" });
        const plantTaken = await prisma.plant.findUnique({
          where: { siteId_qrCode: { siteId, qrCode: data.qrCode } },
          select: { id: true },
        });
        if (plantTaken) return reply.code(409).send({ error: "qr_code_taken" });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.locationShape.update({
          where: { id: req.params.id },
          data,
        });
        if (data.name !== undefined) {
          await syncLocationTagName(tx, u);
        }
        return u;
      });
      await reassignPlantsAfterShapeChange(siteId);
      return { shape: toPublicShape(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/location-shapes/:id",
    async (req, reply) => {
      if (rejectIfReadOnly(req, reply)) return;
      const target = await prisma.locationShape.findFirst({
        where: { id: req.params.id, siteId: req.site!.id },
        select: { id: true },
      });
      if (!target) return reply.code(404).send({ error: "not_found" });
      // The paired Tag (kind=location) and its M:M rows cascade via the FK on
      // Tag.locationShapeId; no extra cleanup needed here.
      await prisma.locationShape.delete({ where: { id: req.params.id } });
      return { ok: true };
    },
  );
};
