import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { qrCodeSchema } from "../lib/qr-code.js";
import { PLANT_INCLUDE, publicPlant } from "../lib/serializers.js";
import { toPublicShape } from "./location-shapes.js";

export const codeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string } }>(
    "/codes/by-qr/:code",
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
      if (plant) return { type: "plant" as const, plant: await publicPlant(plant) };
      const shape = await prisma.locationShape.findUnique({ where: { qrCode: code } });
      if (shape) return { type: "shape" as const, shape: toPublicShape(shape) };
      return reply.code(404).send({ error: "not_found" });
    },
  );
};
