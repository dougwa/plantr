/**
 * Fastify plugin that decorates every request with site/membership/role
 * properties (null defaults) and registers a preHandler that resolves them
 * from req.params.siteId.
 *
 * Register this on the tenant-scoped subtree (mounted under
 * /sites/:siteId/*). Anonymous viewers are allowed when the site is PUBLIC;
 * write permission is enforced inside individual route handlers via
 * `rejectIfReadOnly`.
 */
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { loadSiteContext } from "./site-access.js";

const sitePlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("site", null);
  app.decorateRequest("membership", null);
  app.decorateRequest("role", "ANON");

  app.addHook("preHandler", async (req, reply) => {
    const params = req.params as { siteId?: string };
    const siteId = params.siteId;
    if (!siteId) {
      reply.code(400).send({ error: "missing_site_id" });
      return;
    }
    const ctx = await loadSiteContext(req, reply, siteId, { allowPublic: true });
    if (!ctx) return;
    req.site = ctx.site;
    req.membership = ctx.membership;
    req.role = ctx.role;
  });
};

export default fp(sitePlugin, { name: "site-scope" });
