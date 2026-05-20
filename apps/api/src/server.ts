import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import authPlugin from "./auth/plugin.js";
import { authRoutes } from "./auth/routes.js";
import { siteRoutes } from "./routes/sites.js";
import { invitationRoutes } from "./routes/invitations.js";
import { notificationRoutes } from "./routes/notifications.js";
import sitePlugin from "./lib/site-scope.js";
import { plantRoutes } from "./routes/plants.js";
import { tagRoutes } from "./routes/tags.js";
import { photoRoutes } from "./routes/photos.js";
import { actionRoutes } from "./routes/actions.js";
import { locationShapeRoutes } from "./routes/location-shapes.js";
import { codeRoutes } from "./routes/codes.js";

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
await app.register(siteRoutes);
await app.register(invitationRoutes);
await app.register(notificationRoutes);

// Tenant-scoped subtree — every data route lives under /sites/:siteId/* and
// runs the site-scope preHandler which resolves req.site / req.role from the
// :siteId path param. Public sites permit anonymous (ANON) viewers; write
// permission is enforced inside each handler.
await app.register(
  async (scoped) => {
    await scoped.register(sitePlugin);
    await scoped.register(tagRoutes);
    await scoped.register(plantRoutes);
    await scoped.register(photoRoutes);
    await scoped.register(actionRoutes);
    await scoped.register(locationShapeRoutes);
    await scoped.register(codeRoutes);
  },
  { prefix: "/sites/:siteId" },
);

app.get("/health", async () => ({ ok: true, service: "plantr-api" }));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
