import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  contentTypeFromMime,
  deletePhotoObjects,
  extFromMime,
  uploadPhotoFromBuffer,
} from "../lib/photos.js";
import { identifyFromBuffer, plantNetEnabled } from "../lib/plantnet.js";
import { PLANT_INCLUDE, publicPhoto, publicPlant } from "../lib/serializers.js";

const patchSchema = z.object({
  setCover: z.boolean().optional(),
});

export const photoRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>(
    "/plants/:id/photos",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const plantId = req.params.id;
      const plant = await prisma.plant.findUnique({ where: { id: plantId } });
      if (!plant) return reply.code(404).send({ error: "not_found" });

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "missing_file" });

      const buffer = await file.toBuffer();
      if (!buffer.length) return reply.code(400).send({ error: "empty_file" });

      const photoId = randomUUID();
      const ext = extFromMime(file.mimetype);
      const keys = await uploadPhotoFromBuffer({
        plantId,
        photoId,
        buffer,
        originalExt: ext,
        originalContentType: contentTypeFromMime(file.mimetype),
      });

      const photo = await prisma.photo.create({
        data: {
          id: photoId,
          plantId,
          originalPath: keys.original,
          thumbnailPath: keys.thumb,
          coverPath: keys.cover,
          createdById: req.user!.id,
        },
        include: { createdBy: { select: { id: true, username: true } } },
      });

      const isFirstPhoto = !plant.coverPhotoId;
      if (isFirstPhoto) {
        await prisma.plant.update({
          where: { id: plantId },
          data: { coverPhotoId: photo.id },
        });
      }

      if (isFirstPhoto && !plant.name && plantNetEnabled()) {
        // Fire and forget — don't block the upload response on PlantNet.
        identifyFromBuffer(buffer)
          .then(async (result) => {
            if (!result) return;
            await prisma.plant.update({
              where: { id: plantId },
              data: {
                plantNetData: result.raw as object,
                species: result.scientificName || undefined,
                name: result.commonNames[0] ?? undefined,
              },
            });
            req.log.info({ plantId, score: result.score }, "plantnet identified");
          })
          .catch((err) => req.log.warn({ err }, "plantnet failed"));
      }

      return reply.code(201).send({ photo: await publicPhoto(photo) });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/photos/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

      const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
      if (!photo) return reply.code(404).send({ error: "not_found" });

      if (parsed.data.setCover) {
        const plant = await prisma.plant.update({
          where: { id: photo.plantId },
          data: { coverPhotoId: photo.id },
          include: PLANT_INCLUDE,
        });
        return { plant: await publicPlant(plant) };
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/photos/:id",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const photo = await prisma.photo.findUnique({
        where: { id: req.params.id },
        include: { coverOf: true },
      });
      if (!photo) return reply.code(404).send({ error: "not_found" });

      if (photo.coverOf) {
        await prisma.plant.update({
          where: { id: photo.coverOf.id },
          data: { coverPhotoId: null },
        });
      }
      await prisma.photo.delete({ where: { id: photo.id } });
      await deletePhotoObjects({
        original: photo.originalPath,
        thumb: photo.thumbnailPath,
        cover: photo.coverPath,
      });
      return { ok: true };
    },
  );
};
