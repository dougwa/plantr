/**
 * One-shot backfill for Phase 1 of multi-account support.
 *
 * For every existing User:
 *   - Set email if it can be derived (admin → admin@local; otherwise if the
 *     username already parses as an email, use it). Force mustChangePass for
 *     admin so the legacy default account is locked behind a profile-completion
 *     step on next login.
 *   - Create one PRIVATE Site they own, plus a Membership(OWNER).
 *
 * For every tenanted row (Plant, Photo, Action, LocationShape) with siteId
 * NULL: assign to the owning user's site (via createdById).
 *
 * For every Tag with siteId NULL: attach to the single site referenced by its
 * tagged plants if there's exactly one; if zero, attach to the first site that
 * exists; if more than one, bail with a clear error — the cross-site tag
 * split is rare enough today that we can hand-resolve when it shows up.
 *
 * Idempotent: re-running on a partially-backfilled DB is safe.
 *
 * Run with: pnpm --filter @plantr/api backfill-sites
 */
import { PrismaClient, MembershipRole, Visibility } from "@prisma/client";

const prisma = new PrismaClient();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function siteNameFor(username: string): string {
  if (username === "admin") return "My Garden";
  return `${username}'s Garden`;
}

async function backfillUsers() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  for (const user of users) {
    // 1. Derive email if missing.
    if (!user.email) {
      let email: string | null = null;
      if (user.username === "admin") {
        email = "admin@local";
      } else if (EMAIL_RE.test(user.username)) {
        email = user.username;
      }
      if (email) {
        const conflict = await prisma.user.findUnique({ where: { email } });
        if (!conflict || conflict.id === user.id) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              email,
              // admin@local is a placeholder — force them to set a real email
              // (and matching password) on next login.
              mustChangePass: user.username === "admin" ? true : user.mustChangePass,
            },
          });
          console.log(`[backfill] user ${user.username}: email=${email}`);
        } else {
          console.warn(
            `[backfill] user ${user.username}: email ${email} already taken by ${conflict.id}, leaving null`,
          );
        }
      } else {
        console.warn(
          `[backfill] user ${user.username}: no derivable email — will be prompted at next login`,
        );
      }
    }

    // 2. Ensure they own a Site.
    const owned = await prisma.site.findFirst({ where: { ownerId: user.id } });
    if (!owned) {
      const site = await prisma.site.create({
        data: {
          name: siteNameFor(user.username),
          visibility: Visibility.PRIVATE,
          ownerId: user.id,
        },
      });
      await prisma.membership.create({
        data: {
          siteId: site.id,
          userId: user.id,
          role: MembershipRole.OWNER,
        },
      });
      console.log(`[backfill] user ${user.username}: created site ${site.id} (${site.name})`);
    }
  }
}

async function backfillTenantRows() {
  const owners = await prisma.user.findMany({
    include: { ownedSites: { where: { deletedAt: null }, take: 1 } },
  });
  for (const user of owners) {
    const site = user.ownedSites[0];
    if (!site) continue;

    const [plants, photos, actions, shapes] = await Promise.all([
      prisma.plant.updateMany({
        where: { createdById: user.id, siteId: null },
        data: { siteId: site.id },
      }),
      prisma.photo.updateMany({
        where: { createdById: user.id, siteId: null },
        data: { siteId: site.id },
      }),
      prisma.action.updateMany({
        where: { createdById: user.id, siteId: null },
        data: { siteId: site.id },
      }),
      prisma.locationShape.updateMany({
        where: { createdById: user.id, siteId: null },
        data: { siteId: site.id },
      }),
    ]);
    console.log(
      `[backfill] user ${user.username}: assigned siteId=${site.id} — plants=${plants.count} photos=${photos.count} actions=${actions.count} shapes=${shapes.count}`,
    );
  }
}

async function backfillTags() {
  const tags = await prisma.tag.findMany({
    where: { siteId: null },
    include: { plants: { select: { siteId: true } } },
  });
  if (tags.length === 0) return;

  const allSites = await prisma.site.findMany({ select: { id: true } });
  if (allSites.length === 0) {
    console.warn(`[backfill] ${tags.length} tags need siteId but no sites exist — skipping`);
    return;
  }

  for (const tag of tags) {
    const siteIds = [...new Set(tag.plants.map((p) => p.siteId).filter((s): s is string => !!s))];
    if (siteIds.length === 1) {
      await prisma.tag.update({ where: { id: tag.id }, data: { siteId: siteIds[0] } });
    } else if (siteIds.length === 0) {
      // Orphan tag — no plants reference it. Park in the first site so the
      // NOT NULL constraint in Phase 4 holds.
      await prisma.tag.update({ where: { id: tag.id }, data: { siteId: allSites[0]!.id } });
    } else {
      throw new Error(
        `tag ${tag.id} "${tag.name}" is referenced across ${siteIds.length} sites — manual split required before Phase 4`,
      );
    }
  }
  console.log(`[backfill] assigned siteId on ${tags.length} tag(s)`);
}

async function main() {
  console.log("[backfill] starting multi-account Phase 1 backfill");
  await backfillUsers();
  await backfillTenantRows();
  await backfillTags();
  console.log("[backfill] done");
}

main()
  .catch((err) => {
    console.error("[backfill] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
