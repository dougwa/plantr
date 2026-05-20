/**
 * Token-keyed invitation routes. These are NOT scoped under /sites/:siteId
 * because the invitee may not yet have access to the site — the token IS the
 * proof of access. GET is intentionally unauthenticated so a fresh signup
 * flow can preview the invitation before creating an account.
 */
import type { FastifyPluginAsync } from "fastify";
import { MembershipRole, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isExpired } from "../lib/invitations.js";
import { dispatch } from "../lib/notifications.js";

export const invitationRoutes: FastifyPluginAsync = async (app) => {
  // -----------------------------------------------------------------------
  // GET /invitations/:token — preview an invitation (anonymous-friendly)
  // -----------------------------------------------------------------------
  app.get<{ Params: { token: string } }>(
    "/invitations/:token",
    async (req, reply) => {
      const invitation = await prisma.invitation.findUnique({
        where: { token: req.params.token },
        include: {
          site: {
            include: { owner: { select: { id: true, username: true, name: true } } },
          },
          invitedBy: { select: { id: true, username: true, name: true } },
        },
      });
      if (!invitation) return reply.code(404).send({ error: "invitation_not_found" });
      if (invitation.site.deletedAt) {
        return reply.code(410).send({ error: "site_deleted" });
      }
      if (invitation.acceptedAt) {
        return reply.code(409).send({ error: "already_accepted" });
      }
      if (isExpired(invitation.expiresAt)) {
        return reply.code(410).send({ error: "expired" });
      }
      return {
        invitation: {
          id: invitation.id,
          role: invitation.role,
          email: invitation.email,
          phone: invitation.phone,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
          site: {
            id: invitation.site.id,
            name: invitation.site.name,
            visibility: invitation.site.visibility,
            owner: {
              id: invitation.site.owner.id,
              username: invitation.site.owner.username,
              name: invitation.site.owner.name,
            },
          },
          invitedBy: {
            id: invitation.invitedBy.id,
            username: invitation.invitedBy.username,
            name: invitation.invitedBy.name,
          },
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /invitations/:token/accept — sign in required
  //
  // For OWNER-role invitations we swap roles atomically (old owner → ADMIN,
  // acceptee → OWNER). For everything else we just create/upgrade the
  // membership.
  // -----------------------------------------------------------------------
  app.post<{ Params: { token: string } }>(
    "/invitations/:token/accept",
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const invitation = await prisma.invitation.findUnique({
        where: { token: req.params.token },
        include: {
          site: true,
          invitedBy: { select: { id: true, username: true, name: true } },
        },
      });
      if (!invitation) return reply.code(404).send({ error: "invitation_not_found" });
      if (invitation.site.deletedAt) {
        return reply.code(410).send({ error: "site_deleted" });
      }
      if (invitation.acceptedAt) {
        return reply.code(409).send({ error: "already_accepted" });
      }
      if (isExpired(invitation.expiresAt)) {
        return reply.code(410).send({ error: "expired" });
      }

      const userId = req.user!.id;
      const isOwnershipOffer = invitation.role === MembershipRole.OWNER;

      try {
        await prisma.$transaction(async (tx) => {
          if (isOwnershipOffer) {
            // Demote the current owner to ADMIN, promote the accepting user
            // to OWNER, and rewrite Site.ownerId.
            const acceptingMembership = await tx.membership.findUnique({
              where: { siteId_userId: { siteId: invitation.siteId, userId } },
            });
            if (acceptingMembership) {
              await tx.membership.update({
                where: { id: acceptingMembership.id },
                data: { role: MembershipRole.OWNER },
              });
            } else {
              await tx.membership.create({
                data: { siteId: invitation.siteId, userId, role: MembershipRole.OWNER },
              });
            }
            // Demote the previous owner if they still have a membership row.
            await tx.membership
              .update({
                where: {
                  siteId_userId: {
                    siteId: invitation.siteId,
                    userId: invitation.site.ownerId,
                  },
                },
                data: { role: MembershipRole.ADMIN },
              })
              .catch(() => {});
            await tx.site.update({
              where: { id: invitation.siteId },
              data: { ownerId: userId },
            });
          } else {
            // Standard role invitation. If the user already had a lower-rank
            // membership, upgrade it (don't downgrade them).
            const existing = await tx.membership.findUnique({
              where: { siteId_userId: { siteId: invitation.siteId, userId } },
            });
            if (existing) {
              if (existing.role === MembershipRole.OWNER) {
                // No-op: already owns the site somehow.
              } else {
                await tx.membership.update({
                  where: { id: existing.id },
                  data: { role: invitation.role },
                });
              }
            } else {
              await tx.membership.create({
                data: { siteId: invitation.siteId, userId, role: invitation.role },
              });
            }
          }
          await tx.invitation.update({
            where: { id: invitation.id },
            data: { acceptedAt: new Date(), acceptedByUserId: userId },
          });
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          req.log.warn({ err }, "invitation accept transaction failed");
          return reply.code(500).send({ error: "accept_failed" });
        }
        throw err;
      }

      // Notify the inviter (in-app).
      const accepter = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      await dispatch(
        {
          kind: "invitation_accepted",
          data: {
            siteId: invitation.siteId,
            siteName: invitation.site.name,
            invitationId: invitation.id,
            accepterId: accepter.id,
            accepterName: accepter.name ?? accepter.username,
            role: invitation.role,
          },
          to: { userId: invitation.invitedById, email: invitation.invitedBy ? null : null },
          subject: `${accepter.name ?? accepter.username} accepted your invitation`,
          body: `${accepter.name ?? accepter.username} joined ${invitation.site.name} as ${invitation.role}.`,
        },
        req.log,
      );

      return {
        site: {
          id: invitation.siteId,
          name: invitation.site.name,
        },
        role: invitation.role,
      };
    },
  );
};
