import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  MembershipRole,
  Prisma,
  Visibility,
  type Membership,
  type Site,
  type User,
} from "@prisma/client";
import { prisma } from "../db.js";
import { geocodeAddress } from "../lib/geocode.js";
import { planLimits } from "../lib/plans.js";
import {
  canManageMembers,
  canManageSite,
  loadSiteContext,
  RoleRank,
  type EffectiveRole,
} from "../lib/site-access.js";

const SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(512).optional(),
  visibility: z.nativeEnum(Visibility).optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(512).nullable().optional(),
  visibility: z.nativeEnum(Visibility).optional(),
});

const transferSchema = z.object({
  toUserId: z.string().min(1).max(64),
});

const memberPatchSchema = z.object({
  role: z.nativeEnum(MembershipRole),
});

const publicSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  // Search radius in kilometers. Default 50km when lat/lng provided.
  radiusKm: z.coerce.number().min(0.1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

type SiteWithOwner = Site & { owner: Pick<User, "id" | "username" | "name"> };
type MembershipWithUser = Membership & {
  user: Pick<User, "id" | "username" | "name" | "email">;
};

function publicSite(s: SiteWithOwner) {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    visibility: s.visibility,
    deletedAt: s.deletedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    owner: { id: s.owner.id, username: s.owner.username, name: s.owner.name },
  };
}

function publicMembership(m: MembershipWithUser) {
  return {
    id: m.id,
    siteId: m.siteId,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
    user: {
      id: m.user.id,
      username: m.user.username,
      name: m.user.name,
      email: m.user.email,
    },
  };
}

/**
 * Haversine distance in km between two lat/lng points. Used to sort public
 * sites by proximity after a coarse bounding-box filter in SQL.
 */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const siteRoutes: FastifyPluginAsync = async (app) => {
  // -----------------------------------------------------------------------
  // POST /sites — create a new site (caller becomes Owner)
  // -----------------------------------------------------------------------
  app.post("/sites", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }
    const { name, address, visibility } = parsed.data;
    const userId = req.user!.id;

    // Plan limit: count sites this user currently owns (excluding soft-deleted
    // ones — those still count toward the cap during the 30-day retention
    // window so a user can't game it by deleting and re-creating).
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const limits = planLimits(user.plan);
    const ownedCount = await prisma.site.count({ where: { ownerId: userId } });
    if (ownedCount >= limits.ownedSites) {
      return reply.code(402).send({
        error: "plan_limit_owned_sites",
        limit: limits.ownedSites,
      });
    }

    let lat: number | null = null;
    let lng: number | null = null;
    if (address) {
      const coords = await geocodeAddress(address);
      if (coords) {
        lat = coords.lat;
        lng = coords.lng;
      }
    }

    const created = await prisma.site.create({
      data: {
        name,
        address: address ?? null,
        lat,
        lng,
        visibility: visibility ?? Visibility.PRIVATE,
        ownerId: userId,
        memberships: { create: { userId, role: MembershipRole.OWNER } },
      },
      include: { owner: { select: { id: true, username: true, name: true } } },
    });
    return reply.code(201).send({ site: publicSite(created) });
  });

  // -----------------------------------------------------------------------
  // GET /sites — sites the caller is a member of
  // -----------------------------------------------------------------------
  app.get("/sites", { onRequest: [app.requireAuth] }, async (req) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.id, site: { deletedAt: null } },
      include: {
        site: {
          include: { owner: { select: { id: true, username: true, name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      sites: memberships.map((m) => ({
        ...publicSite(m.site),
        role: m.role,
      })),
    };
  });

  // -----------------------------------------------------------------------
  // GET /sites/public/search — discover public sites
  //
  // Routed *before* /sites/:siteId so Fastify doesn't try to treat "public"
  // as a siteId.
  // -----------------------------------------------------------------------
  app.get("/sites/public/search", async (req, reply) => {
    const parsed = publicSearchSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { q, lat, lng, radiusKm, limit } = parsed.data;

    const where: Prisma.SiteWhereInput = {
      visibility: Visibility.PUBLIC,
      deletedAt: null,
    };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { address: { contains: q, mode: "insensitive" } },
      ];
    }

    // Bounding-box prefilter when lat/lng provided. 1 degree of latitude ≈
    // 111 km; longitude varies with latitude. This is a coarse filter — we
    // refine with Haversine in app code below.
    let nearby: { lat: number; lng: number; radiusKm: number } | null = null;
    if (lat !== undefined && lng !== undefined) {
      const r = radiusKm ?? 50;
      nearby = { lat, lng, radiusKm: r };
      const latDelta = r / 111;
      const lngDelta = r / (111 * Math.cos((lat * Math.PI) / 180) || 1);
      where.lat = { gte: lat - latDelta, lte: lat + latDelta };
      where.lng = { gte: lng - lngDelta, lte: lng + lngDelta };
    }

    const sites = await prisma.site.findMany({
      where,
      include: { owner: { select: { id: true, username: true, name: true } } },
      take: nearby ? limit * 3 : limit,
      orderBy: { createdAt: "desc" },
    });

    let results = sites.map((s) => ({
      ...publicSite(s),
      distanceKm: null as number | null,
    }));
    if (nearby) {
      results = results
        .map((s) => {
          if (s.lat == null || s.lng == null) return { ...s, distanceKm: null };
          const d = haversineKm({ lat: nearby!.lat, lng: nearby!.lng }, {
            lat: s.lat,
            lng: s.lng,
          });
          return { ...s, distanceKm: d };
        })
        .filter((s) => s.distanceKm == null || s.distanceKm <= nearby!.radiusKm)
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
        .slice(0, limit);
    }
    return { sites: results };
  });

  // -----------------------------------------------------------------------
  // GET /sites/:siteId — site detail (members + public anons)
  // -----------------------------------------------------------------------
  app.get<{ Params: { siteId: string } }>("/sites/:siteId", async (req, reply) => {
    const ctx = await loadSiteContext(req, reply, req.params.siteId, {
      allowPublic: true,
    });
    if (!ctx) return;
    const site = await prisma.site.findUniqueOrThrow({
      where: { id: ctx.site.id },
      include: { owner: { select: { id: true, username: true, name: true } } },
    });
    return { site: publicSite(site), role: ctx.role };
  });

  // -----------------------------------------------------------------------
  // PATCH /sites/:siteId — update name/address/visibility
  // -----------------------------------------------------------------------
  app.patch<{ Params: { siteId: string } }>(
    "/sites/:siteId",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const ctx = await loadSiteContext(req, reply, req.params.siteId, {
        minRole: "ADMIN",
      });
      if (!ctx) return;
      if (!canManageSite(ctx.role)) {
        return reply.code(403).send({ error: "insufficient_role" });
      }
      const { name, address, visibility } = parsed.data;

      // Visibility flip is Owner-only.
      if (visibility !== undefined && visibility !== ctx.site.visibility) {
        if (ctx.role !== "OWNER") {
          return reply.code(403).send({ error: "owner_only" });
        }
      }

      const data: Prisma.SiteUpdateInput = {};
      if (name !== undefined) data.name = name;
      if (visibility !== undefined) data.visibility = visibility;
      if (address !== undefined) {
        if (address === null || address === "") {
          data.address = null;
          data.lat = null;
          data.lng = null;
        } else if (address !== ctx.site.address) {
          data.address = address;
          const coords = await geocodeAddress(address);
          data.lat = coords?.lat ?? null;
          data.lng = coords?.lng ?? null;
        }
      }

      const updated = await prisma.site.update({
        where: { id: ctx.site.id },
        data,
        include: { owner: { select: { id: true, username: true, name: true } } },
      });
      return { site: publicSite(updated) };
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /sites/:siteId — soft-delete (30-day retention)
  // -----------------------------------------------------------------------
  app.delete<{ Params: { siteId: string } }>(
    "/sites/:siteId",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const ctx = await loadSiteContext(req, reply, req.params.siteId, {
        minRole: "OWNER",
      });
      if (!ctx) return;
      if (ctx.site.deletedAt) {
        return reply.code(409).send({ error: "already_deleted" });
      }
      const updated = await prisma.site.update({
        where: { id: ctx.site.id },
        data: { deletedAt: new Date() },
        include: { owner: { select: { id: true, username: true, name: true } } },
      });
      return { site: publicSite(updated) };
    },
  );

  // -----------------------------------------------------------------------
  // POST /sites/:siteId/restore — undo soft-delete within retention
  // -----------------------------------------------------------------------
  app.post<{ Params: { siteId: string } }>(
    "/sites/:siteId/restore",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const ctx = await loadSiteContext(req, reply, req.params.siteId, {
        minRole: "OWNER",
        includeDeleted: true,
      });
      if (!ctx) return;
      if (!ctx.site.deletedAt) {
        return reply.code(409).send({ error: "not_deleted" });
      }
      const age = Date.now() - ctx.site.deletedAt.getTime();
      if (age > SOFT_DELETE_RETENTION_MS) {
        return reply.code(410).send({ error: "retention_expired" });
      }
      const updated = await prisma.site.update({
        where: { id: ctx.site.id },
        data: { deletedAt: null },
        include: { owner: { select: { id: true, username: true, name: true } } },
      });
      return { site: publicSite(updated) };
    },
  );

  // -----------------------------------------------------------------------
  // POST /sites/:siteId/transfer — move ownership to an existing member
  //
  // Phase 8 will convert this into an invite-style acceptance flow; for now
  // the transfer is immediate. Existing owner becomes Admin so they can keep
  // working until the new owner has a chance to adjust permissions.
  // -----------------------------------------------------------------------
  app.post<{ Params: { siteId: string } }>(
    "/sites/:siteId/transfer",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const ctx = await loadSiteContext(req, reply, req.params.siteId, {
        minRole: "OWNER",
      });
      if (!ctx) return;
      const { toUserId } = parsed.data;
      if (toUserId === ctx.site.ownerId) {
        return reply.code(400).send({ error: "already_owner" });
      }

      const targetMembership = await prisma.membership.findUnique({
        where: { siteId_userId: { siteId: ctx.site.id, userId: toUserId } },
      });
      if (!targetMembership) {
        return reply.code(400).send({ error: "target_not_member" });
      }

      // Atomic role swap.
      const updated = await prisma.$transaction(async (tx) => {
        await tx.membership.update({
          where: { id: targetMembership.id },
          data: { role: MembershipRole.OWNER },
        });
        await tx.membership.update({
          where: {
            siteId_userId: { siteId: ctx.site.id, userId: ctx.site.ownerId },
          },
          data: { role: MembershipRole.ADMIN },
        });
        return tx.site.update({
          where: { id: ctx.site.id },
          data: { ownerId: toUserId },
          include: { owner: { select: { id: true, username: true, name: true } } },
        });
      });
      return { site: publicSite(updated) };
    },
  );

  // -----------------------------------------------------------------------
  // GET /sites/:siteId/members
  // -----------------------------------------------------------------------
  app.get<{ Params: { siteId: string } }>(
    "/sites/:siteId/members",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const ctx = await loadSiteContext(req, reply, req.params.siteId);
      if (!ctx) return;
      const members = await prisma.membership.findMany({
        where: { siteId: ctx.site.id },
        include: {
          user: { select: { id: true, username: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return { members: members.map(publicMembership) };
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /sites/:siteId/members/:userId — change role
  // -----------------------------------------------------------------------
  app.patch<{ Params: { siteId: string; userId: string } }>(
    "/sites/:siteId/members/:userId",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const parsed = memberPatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const ctx = await loadSiteContext(req, reply, req.params.siteId, {
        minRole: "ADMIN",
      });
      if (!ctx) return;
      if (!canManageMembers(ctx.role)) {
        return reply.code(403).send({ error: "insufficient_role" });
      }
      const { userId } = req.params;
      const { role } = parsed.data;

      // OWNER role is only assignable via the transfer endpoint.
      if (role === MembershipRole.OWNER) {
        return reply.code(400).send({ error: "use_transfer_for_owner" });
      }
      // Can't demote the current owner via this endpoint.
      if (userId === ctx.site.ownerId) {
        return reply.code(400).send({ error: "cannot_demote_owner" });
      }
      // Admins can't change peer admins' roles — only the owner can.
      const target = await prisma.membership.findUnique({
        where: { siteId_userId: { siteId: ctx.site.id, userId } },
      });
      if (!target) return reply.code(404).send({ error: "member_not_found" });
      if (
        ctx.role === "ADMIN" &&
        RoleRank[target.role as EffectiveRole] >= RoleRank.ADMIN
      ) {
        return reply.code(403).send({ error: "owner_only" });
      }

      const updated = await prisma.membership.update({
        where: { id: target.id },
        data: { role },
        include: {
          user: { select: { id: true, username: true, name: true, email: true } },
        },
      });
      return { member: publicMembership(updated) };
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /sites/:siteId/members/:userId — remove (or leave)
  // -----------------------------------------------------------------------
  app.delete<{ Params: { siteId: string; userId: string } }>(
    "/sites/:siteId/members/:userId",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const ctx = await loadSiteContext(req, reply, req.params.siteId);
      if (!ctx) return;
      const targetUserId = req.params.userId;
      const isSelf = targetUserId === req.user!.id;

      if (targetUserId === ctx.site.ownerId) {
        return reply.code(400).send({ error: "cannot_remove_owner" });
      }
      if (!isSelf && !canManageMembers(ctx.role)) {
        return reply.code(403).send({ error: "insufficient_role" });
      }
      // Admins can't kick a fellow admin — only Owner can.
      if (!isSelf && ctx.role === "ADMIN") {
        const target = await prisma.membership.findUnique({
          where: { siteId_userId: { siteId: ctx.site.id, userId: targetUserId } },
        });
        if (target && RoleRank[target.role as EffectiveRole] >= RoleRank.ADMIN) {
          return reply.code(403).send({ error: "owner_only" });
        }
      }

      await prisma.membership
        .delete({
          where: { siteId_userId: { siteId: ctx.site.id, userId: targetUserId } },
        })
        .catch(() => {
          /* tolerate already-gone */
        });
      return { ok: true };
    },
  );
};
