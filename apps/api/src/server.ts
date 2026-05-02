import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import authPlugin from "./auth/plugin.js";
import { authRoutes } from "./auth/routes.js";
import { plantRoutes } from "./routes/plants.js";
import { plantTypeRoutes } from "./routes/plant-types.js";
import { photoRoutes } from "./routes/photos.js";
import { actionRoutes } from "./routes/actions.js";
import { locationShapeRoutes } from "./routes/location-shapes.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB per photo
    files: 1,
  },
});
await app.register(authPlugin);
await app.register(authRoutes);
await app.register(plantTypeRoutes);
await app.register(plantRoutes);
await app.register(photoRoutes);
await app.register(actionRoutes);
await app.register(locationShapeRoutes);

app.get("/health", async () => ({ ok: true, service: "plantr-api" }));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
