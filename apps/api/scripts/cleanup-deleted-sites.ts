/**
 * Phase 8 retention cleanup. Runs through every Site with
 * deletedAt < now - 30 days and hard-deletes it: every Plant / Photo / Action /
 * LocationShape / Tag / Membership / Invitation cascades via the schema's
 * onDelete: Cascade. Photo objects in Spaces are NOT cascaded — we explicitly
 * walk the photo rows first and delete the S3 objects, then drop the rows.
 *
 * Idempotent: running twice in a row only acts on rows that crossed the
 * retention boundary since last run.
 *
 * Run with: pnpm --filter @plantr/api cleanup-deleted-sites
 */
import { PrismaClient } from "@prisma/client";
import { deletePhotoObjects } from "../src/lib/photos.js";

const prisma = new PrismaClient();
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  console.log(`[cleanup] cutoff: ${cutoff.toISOString()}`);

  const sites = await prisma.site.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, name: true, deletedAt: true },
  });
  console.log(`[cleanup] ${sites.length} site(s) past retention`);

  let deletedSites = 0;
  let deletedPhotos = 0;
  const failures: { siteId: string; reason: string }[] = [];

  for (const s of sites) {
    try {
      // 1. Pull every photo so we can remove the Spaces objects before
      // the row cascades away.
      const photos = await prisma.photo.findMany({
        where: { siteId: s.id },
        select: { id: true, originalPath: true, thumbnailPath: true, coverPath: true },
      });
      for (const p of photos) {
        await deletePhotoObjects({
          original: p.originalPath,
          thumb: p.thumbnailPath,
          cover: p.coverPath,
        }).catch((err: unknown) => {
          console.warn(`[cleanup] photo ${p.id} object delete failed:`, err);
        });
        deletedPhotos++;
      }

      // 2. Drop the cover-photo back-reference so the cascade can sweep
      // through Plant → Photo without tripping the unique constraint.
      await prisma.plant.updateMany({
        where: { siteId: s.id, coverPhotoId: { not: null } },
        data: { coverPhotoId: null },
      });

      // 3. Hard-delete the Site. Cascades remove plants / photos / actions /
      // shapes / tags / memberships / invitations.
      await prisma.site.delete({ where: { id: s.id } });
      deletedSites++;
      console.log(
        `[cleanup] site ${s.id} (${s.name}) hard-deleted — ${photos.length} photo(s)`,
      );
    } catch (err) {
      failures.push({ siteId: s.id, reason: (err as Error).message });
      console.error(`[cleanup] FAIL site ${s.id}:`, err);
    }
  }

  console.log(
    `[cleanup] done — sites=${deletedSites} photos=${deletedPhotos} failures=${failures.length}`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[cleanup] FATAL:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
