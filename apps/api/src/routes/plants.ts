import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { deletePhotoObjects } from "../lib/photos.js";
import { signGetUrl } from "../lib/spaces.js";
import { PLANT_INCLUDE, publicPlant, publicTag } from "../lib/serializers.js";
import { qrCodeSchema } from "../lib/qr-code.js";
import { planLimitsFor } from "../lib/plans.js";
import { rejectIfReadOnly } from "../lib/site-access.js";
import {
  resolveLocationTagIdsForPoint,
  syncPlantLocationTags,
} from "../lib/location-tags.js";

const createSchema = z.object({
  qrCode: qrCodeSchema,
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
});

const patchSchema = z.object({
  name: z.string().max(128).nullable().optional(),
  tagIds: z.array(z.string()).max(64).optional(),
  species: z.string().max(128).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  gpsLat: z.number().min(-90).max(90).nullable().optional(),
  gpsLng: z.number().min(-180).max(180).nullable().optional(),
});

export const plantRoutes: FastifyPluginAsync = async (app) => {
  app.get("/plants", async (req) => {
    const plants = await prisma.plant.findMany({
      where: { siteId: req.site!.id },
      orderBy: { createdAt: "asc" },
      include: {
        tags: { orderBy: [{ kind: "asc" }, { name: "asc" }] },
        coverPhoto: { select: { thumbnailPath: true } },
      },
    });
    return {
      plants: plants.map((p) => ({
        id: p.id,
        qrCode: p.qrCode,
        name: p.name,
        tags: p.tags.map(publicTag),
        species: p.species,
        gpsLat: p.gpsLat,
        gpsLng: p.gpsLng,
        coverPhotoThumbUrl: p.coverPhoto
          ? signGetUrl(p.coverPhoto.thumbnailPath)
          : null,
      })),
    };
  });

  app.get<{ Params: { code: string } }>(
    "/plants/by-qr/:code",
    async (req, reply) => {
      const code = req.params.code;
      if (!qrCodeSchema.safeParse(code).success) {
        return reply.code(400).send({ error: "invalid_qr_code" });
      }
      const plant = await prisma.plant.findUnique({
        where: { siteId_qrCode: { siteId: req.site!.id, qrCode: code } },
        include: PLANT_INCLUDE,
      });
      if (!plant) return reply.code(404).send({ error: "not_found" });
      return { plant: publicPlant(plant, req.role) };
    },
  );

  app.post("/plants", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { qrCode, gpsLat, gpsLng } = parsed.data;
    const siteId = req.site!.id;

    // Plan cap is keyed off the site owner's plan, not the caller's.
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: req.site!.ownerId },
    });
    const limits = planLimitsFor(owner);
    const plantCount = await prisma.plant.count({ where: { siteId } });
    if (plantCount >= limits.plantsPerSite) {
      return reply.code(402).send({
        error: "plan_limit_plants_per_site",
        limit: limits.plantsPerSite,
      });
    }

    const existing = await prisma.plant.findUnique({
      where: { siteId_qrCode: { siteId, qrCode } },
    });
    if (existing) return reply.code(409).send({ error: "qr_code_taken" });
    const shapeUsing = await prisma.locationShape.findUnique({
      where: { siteId_qrCode: { siteId, qrCode } },
      select: { id: true },
    });
    if (shapeUsing) return reply.code(409).send({ error: "qr_code_taken" });

    const locationTagIds = await resolveLocationTagIdsForPoint(
      siteId,
      gpsLat ?? null,
      gpsLng ?? null,
    );

    const plant = await prisma.plant.create({
      data: {
        qrCode,
        gpsLat: gpsLat ?? null,
        gpsLng: gpsLng ?? null,
        siteId,
        createdById: req.user!.id,
        tags: locationTagIds.length
          ? { connect: locationTagIds.map((id) => ({ id })) }
          : undefined,
      },
      include: PLANT_INCLUDE,
    });
    return reply.code(201).send({ plant: publicPlant(plant, req.role) });
  });

  app.get<{ Params: { id: string } }>("/plants/:id", async (req, reply) => {
    const plant = await prisma.plant.findFirst({
      where: { id: req.params.id, siteId: req.site!.id },
      include: PLANT_INCLUDE,
    });
    if (!plant) return reply.code(404).send({ error: "not_found" });
    return { plant: publicPlant(plant, req.role) };
  });

  app.patch<{ Params: { id: string } }>("/plants/:id", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    // Existence + tenant check before mutating.
    const own = await prisma.plant.findFirst({
      where: { id: req.params.id, siteId: req.site!.id },
      select: { id: true },
    });
    if (!own) return reply.code(404).send({ error: "not_found" });

    const { tagIds, ...rest } = parsed.data;
    const data: Prisma.PlantUpdateInput = { ...rest };

    if (tagIds !== undefined) {
      if (tagIds.length > 0) {
        const found = await prisma.tag.findMany({
          where: { id: { in: tagIds }, siteId: req.site!.id },
          select: { id: true },
        });
        if (found.length !== new Set(tagIds).size) {
          return reply.code(400).send({ error: "invalid_tag_id" });
        }
      }
      data.tags = { set: tagIds.map((id) => ({ id })) };
    }

    const updated = await prisma.plant.update({
      where: { id: req.params.id },
      data,
      include: PLANT_INCLUDE,
    });

    // If GPS changed (and tagIds wasn't explicitly set in this same request),
    // resync the plant's location-kind tags from the new GPS. tagIds set
    // explicitly wins — user choice overrides auto-resolution for this call.
    if (
      tagIds === undefined &&
      (parsed.data.gpsLat !== undefined || parsed.data.gpsLng !== undefined)
    ) {
      await syncPlantLocationTags(updated.id, updated.gpsLat, updated.gpsLng);
      const refreshed = await prisma.plant.findUnique({
        where: { id: updated.id },
        include: PLANT_INCLUDE,
      });
      if (refreshed) return { plant: publicPlant(refreshed, req.role) };
    }
    return { plant: publicPlant(updated, req.role) };
  });

  // Reset clears every editable field on a plant (and its photos/actions)
  // so the QR code can be reused for a different physical plant. The plant
  // row and its qrCode stay; cover photo, photos, actions, name, type,
  // species, description, notes, GPS, tags, and plantNetData are wiped.
  app.post<{ Params: { id: string } }>(
    "/plants/:id/reset",
    async (req, reply) => {
      if (rejectIfReadOnly(req, reply)) return;
      const id = req.params.id;
      const plant = await prisma.plant.findFirst({
        where: { id, siteId: req.site!.id },
        include: { photos: true },
      });
      if (!plant) return reply.code(404).send({ error: "not_found" });

      // Drop the cover-photo back-reference before deleting photos so the
      // unique relation doesn't block the deletes.
      await prisma.plant.update({
        where: { id },
        data: { coverPhotoId: null },
      });
      await prisma.action.deleteMany({ where: { plantId: id } });
      await prisma.photo.deleteMany({ where: { plantId: id } });
      await Promise.all(
        plant.photos.map((p) =>
          deletePhotoObjects({
            original: p.originalPath,
            thumb: p.thumbnailPath,
            cover: p.coverPath,
          }),
        ),
      );
      const reset = await prisma.plant.update({
        where: { id },
        data: {
          name: null,
          tags: { set: [] },
          species: null,
          description: null,
          notes: null,
          gpsLat: null,
          gpsLng: null,
          plantNetData: undefined,
        },
        include: PLANT_INCLUDE,
      });
      return { plant: publicPlant(reset, req.role) };
    },
  );

  // Delete removes the plant entirely. Photos and actions cascade via the
  // schema's onDelete: Cascade; we still need to remove the Spaces objects.
  app.delete<{ Params: { id: string } }>("/plants/:id", async (req, reply) => {
    if (rejectIfReadOnly(req, reply)) return;
    const id = req.params.id;
    const plant = await prisma.plant.findFirst({
      where: { id, siteId: req.site!.id },
      include: { photos: true },
    });
    if (!plant) return reply.code(404).send({ error: "not_found" });

    await prisma.plant.update({
      where: { id },
      data: { coverPhotoId: null },
    });
    await prisma.plant.delete({ where: { id } });
    await Promise.all(
      plant.photos.map((p) =>
        deletePhotoObjects({
          original: p.originalPath,
          thumb: p.thumbnailPath,
          cover: p.coverPath,
        }),
      ),
    );
    return { ok: true };
  });
};
