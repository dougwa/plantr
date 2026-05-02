import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { env } from "./env.js";
import authPlugin from "./auth/plugin.js";
import { authRoutes } from "./auth/routes.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(authPlugin);
await app.register(authRoutes);

app.get("/health", async () => ({ ok: true, service: "plantr-api" }));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
