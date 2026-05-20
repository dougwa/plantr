/**
 * One-shot migration: lift every Photo row's three variant files off the local
 * filesystem and into the Spaces bucket. Updates each row's *Path columns to
 * the new S3 keys. After all referenced photos are migrated, walks
 * STORAGE_DIR/photos/** and deletes any leftover files that aren't referenced
 * by a current DB row (orphans).
 *
 * Idempotent on the DB side: a Photo whose *Path columns no longer point at
 * the local filesystem (i.e. already look like S3 keys, `photos/...`) is
 * skipped.
 *
 * Run with: pnpm --filter @plantr/api migrate-photos
 */
import path from "node:path";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/env.js";
import { photoObjectKeys } from "../src/lib/photos.js";
import { putObject } from "../src/lib/spaces.js";

const prisma = new PrismaClient();
const STORAGE_ROOT = path.resolve(env.STORAGE_DIR);

type Variant = "original" | "thumb" | "cover";

const VARIANT_TO_FIELD: Record<Variant, "originalPath" | "thumbnailPath" | "coverPath"> = {
  original: "originalPath",
  thumb: "thumbnailPath",
  cover: "coverPath",
};

function contentTypeForKey(key: string): string {
  const ext = path.extname(key).slice(1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}

function isAlreadyS3Key(value: string): boolean {
  // S3 keys we generate live under "photos/{plantId}/...". Local paths are
  // always absolute (start with "/"), so this discriminates cleanly.
  return value.startsWith("photos/");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function migrateOne(photo: {
  id: string;
  plantId: string;
  originalPath: string;
  thumbnailPath: string;
  coverPath: string;
}): Promise<{ migrated: boolean; reason?: string }> {
  if (
    isAlreadyS3Key(photo.originalPath) &&
    isAlreadyS3Key(photo.thumbnailPath) &&
    isAlreadyS3Key(photo.coverPath)
  ) {
    return { migrated: false, reason: "already-s3" };
  }

  // Derive the new keys. The original-extension is read off the existing
  // filesystem path so we preserve the variant accurately.
  const originalExt = path.extname(photo.originalPath).slice(1) || "jpg";
  const newKeys = photoObjectKeys(photo.plantId, photo.id, originalExt);

  const sources: Record<Variant, string> = {
    original: photo.originalPath,
    thumb: photo.thumbnailPath,
    cover: photo.coverPath,
  };

  for (const variant of ["original", "thumb", "cover"] as Variant[]) {
    const src = sources[variant];
    if (isAlreadyS3Key(src)) continue;
    if (!(await fileExists(src))) {
      return { migrated: false, reason: `missing-local-file:${variant}:${src}` };
    }
    const body = await fs.readFile(src);
    const targetKey = newKeys[variant];
    await putObject({
      key: targetKey,
      body,
      contentType: contentTypeForKey(targetKey),
    });
  }

  await prisma.photo.update({
    where: { id: photo.id },
    data: {
      originalPath: newKeys.original,
      thumbnailPath: newKeys.thumb,
      coverPath: newKeys.cover,
    },
  });
  return { migrated: true };
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recur(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await recur(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await recur(root);
  return out;
}

async function main() {
  const photosRoot = path.join(STORAGE_ROOT, "photos");
  console.log(`[migrate] storage root: ${STORAGE_ROOT}`);
  console.log(`[migrate] photos root:  ${photosRoot}`);
  console.log(`[migrate] target bucket: ${env.SPACES_BUCKET} (region ${env.SPACES_REGION})`);

  // 1) Upload every DB-referenced photo to Spaces.
  const photos = await prisma.photo.findMany({
    select: {
      id: true,
      plantId: true,
      originalPath: true,
      thumbnailPath: true,
      coverPath: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`[migrate] ${photos.length} Photo row(s) to consider`);

  let migrated = 0;
  let skippedAlready = 0;
  const failures: { id: string; reason: string }[] = [];
  for (const p of photos) {
    try {
      const r = await migrateOne(p);
      if (r.migrated) {
        migrated++;
        console.log(`[migrate] uploaded photo ${p.id} (plant ${p.plantId})`);
      } else if (r.reason === "already-s3") {
        skippedAlready++;
      } else {
        failures.push({ id: p.id, reason: r.reason ?? "unknown" });
        console.warn(`[migrate] SKIP photo ${p.id}: ${r.reason}`);
      }
    } catch (err) {
      failures.push({ id: p.id, reason: (err as Error).message });
      console.error(`[migrate] FAIL photo ${p.id}:`, err);
    }
  }
  console.log(
    `[migrate] uploads done — migrated=${migrated} already=${skippedAlready} failed=${failures.length}`,
  );

  // 2) Delete any leftover local files. After (1), every Photo row points at
  //    an S3 key — so anything still on disk is unreferenced. We delete the
  //    whole local photos tree.
  if (failures.length === 0) {
    const localFiles = await walkFiles(photosRoot);
    console.log(`[migrate] removing ${localFiles.length} orphaned local file(s)`);
    let removed = 0;
    for (const f of localFiles) {
      try {
        await fs.unlink(f);
        removed++;
      } catch (err) {
        console.warn(`[migrate] could not delete ${f}:`, err);
      }
    }
    // Best-effort directory cleanup (won't fail if non-empty).
    async function rmEmptyDirs(dir: string) {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) await rmEmptyDirs(path.join(dir, e.name));
      }
      try {
        await fs.rmdir(dir);
      } catch {
        /* not empty or doesn't exist — ignore */
      }
    }
    await rmEmptyDirs(photosRoot);
    console.log(`[migrate] removed ${removed} local file(s)`);
  } else {
    console.warn(
      `[migrate] skipping orphan cleanup — ${failures.length} upload failure(s); rerun after resolving`,
    );
  }

  await prisma.$disconnect();
  if (failures.length > 0) {
    console.error("[migrate] FAILURES:");
    for (const f of failures) console.error(`  ${f.id}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
