import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import sharp from "sharp";
import { env } from "../env.js";

const STORAGE_ROOT = path.resolve(env.STORAGE_DIR);

export type PhotoVariant = "original" | "thumb" | "cover";

export function plantPhotoDir(plantId: string) {
  return path.join(STORAGE_ROOT, "photos", plantId);
}

export function photoFilePaths(plantId: string, photoId: string, originalExt: string) {
  const dir = plantPhotoDir(plantId);
  const ext = (originalExt || "jpg").replace(/^\./, "").toLowerCase();
  return {
    original: path.join(dir, `${photoId}.original.${ext}`),
    thumb: path.join(dir, `${photoId}.thumb.jpg`),
    cover: path.join(dir, `${photoId}.cover.jpg`),
  };
}

export async function writePhotoFromBuffer(opts: {
  plantId: string;
  photoId: string;
  buffer: Buffer;
  originalExt: string;
}) {
  const dir = plantPhotoDir(opts.plantId);
  await fs.mkdir(dir, { recursive: true });
  const paths = photoFilePaths(opts.plantId, opts.photoId, opts.originalExt);

  await fs.writeFile(paths.original, opts.buffer);

  await sharp(opts.buffer)
    .rotate()
    .resize({ width: 300, height: 300, fit: "cover" })
    .jpeg({ quality: 80 })
    .toFile(paths.thumb);

  await sharp(opts.buffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(paths.cover);

  return paths;
}

export async function deletePhotoFiles(opts: {
  originalPath: string;
  thumbnailPath: string;
  coverPath: string;
}) {
  await Promise.allSettled([
    fs.unlink(opts.originalPath),
    fs.unlink(opts.thumbnailPath),
    fs.unlink(opts.coverPath),
  ]);
}

export function streamPhoto(filePath: string) {
  return createReadStream(filePath);
}

export function extFromMime(mime: string | undefined): string {
  if (!mime) return "jpg";
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic") || m.includes("heif")) return "heic";
  return "jpg";
}

export function mimeFromVariant(variant: PhotoVariant, originalPath: string): string {
  if (variant === "original") {
    const ext = path.extname(originalPath).slice(1).toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "heic" || ext === "heif") return "image/heic";
    return "image/jpeg";
  }
  return "image/jpeg";
}
