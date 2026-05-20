/**
 * Per-request site/role resolution.
 *
 * `loadSiteContext` is called from any route that operates within a site
 * context. It loads the Site, looks up the caller's membership, and decides
 * whether the request is allowed based on the route's declared requirements.
 *
 * Use the `Role` ordering when expressing "this needs at least User" — the
 * `RoleRank` map encodes the hierarchy Owner > Admin > User > Viewer > Anon.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { MembershipRole, type Site, type Membership } from "@prisma/client";
import { prisma } from "../db.js";

export type EffectiveRole = MembershipRole | "ANON";

export const RoleRank: Record<EffectiveRole, number> = {
  ANON: 0,
  VIEWER: 1,
  USER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export type SiteContext = {
  site: Site;
  membership: Membership | null;
  role: EffectiveRole;
};

export type LoadSiteOptions = {
  /** Minimum effective role required. Default: any membership (VIEWER+). */
  minRole?: EffectiveRole;
  /** Allow access to PUBLIC sites without a membership. */
  allowPublic?: boolean;
  /** Pass through soft-deleted sites (used by restore). */
  includeDeleted?: boolean;
};

/**
 * Load + authorize. On success returns the SiteContext; on failure replies
 * with the appropriate HTTP error and returns null. Caller should `return`
 * immediately when result is null.
 */
export async function loadSiteContext(
  req: FastifyRequest,
  reply: FastifyReply,
  siteId: string,
  opts: LoadSiteOptions = {},
): Promise<SiteContext | null> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site || (!opts.includeDeleted && site.deletedAt)) {
    reply.code(404).send({ error: "site_not_found" });
    return null;
  }

  const userId = req.user?.id ?? null;
  let membership: Membership | null = null;
  if (userId) {
    membership = await prisma.membership.findUnique({
      where: { siteId_userId: { siteId: site.id, userId } },
    });
  }

  let role: EffectiveRole;
  if (membership) {
    role = membership.role;
  } else if (opts.allowPublic && site.visibility === "PUBLIC") {
    role = "ANON";
  } else {
    reply.code(userId ? 403 : 401).send({
      error: userId ? "site_forbidden" : "unauthorized",
    });
    return null;
  }

  const min = opts.minRole ?? "VIEWER";
  if (RoleRank[role] < RoleRank[min]) {
    reply.code(403).send({ error: "insufficient_role" });
    return null;
  }

  return { site, membership, role };
}

export function canManageMembers(role: EffectiveRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageSite(role: EffectiveRole): boolean {
  // Updates to site name/address are Owner/Admin; visibility flip is Owner-only
  // (enforced at the route level).
  return role === "OWNER" || role === "ADMIN";
}
