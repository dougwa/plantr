import sharp from "sharp";
import { deleteObjects, putObject, signGetUrl } from "./spaces.js";

export type PhotoVariant = "original" | "thumb" | "cover";

export type PhotoKeys = {
  original: string;
  thumb: string;
  cover: string;
};

export function photoObjectKeys(
  plantId: string,
  photoId: string,
  originalExt: string,
): PhotoKeys {
  const ext = (originalExt || "jpg").replace(/^\./, "").toLowerCase();
  const base = `photos/${plantId}/${photoId}`;
  return {
    original: `${base}.original.${ext}`,
    thumb: `${base}.thumb.jpg`,
    cover: `${base}.cover.jpg`,
  };
}

export async function uploadPhotoFromBuffer(opts: {
  plantId: string;
  photoId: string;
  buffer: Buffer;
  originalExt: string;
  originalContentType: string;
}): Promise<PhotoKeys> {
  const keys = photoObjectKeys(opts.plantId, opts.photoId, opts.originalExt);

  const [thumbBuf, coverBuf] = await Promise.all([
    sharp(opts.buffer)
      .rotate()
      .resize({ width: 300, height: 300, fit: "cover" })
      .jpeg({ quality: 80 })
      .toBuffer(),
    sharp(opts.buffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer(),
  ]);

  await Promise.all([
    putObject({
      key: keys.original,
      body: opts.buffer,
      contentType: opts.originalContentType,
    }),
    putObject({ key: keys.thumb, body: thumbBuf, contentType: "image/jpeg" }),
    putObject({ key: keys.cover, body: coverBuf, contentType: "image/jpeg" }),
  ]);

  return keys;
}

export async function deletePhotoObjects(keys: PhotoKeys): Promise<void> {
  await deleteObjects([keys.original, keys.thumb, keys.cover]);
}

export async function signedUrlsFor(keys: PhotoKeys): Promise<PhotoKeys> {
  const [original, thumb, cover] = await Promise.all([
    signGetUrl(keys.original),
    signGetUrl(keys.thumb),
    signGetUrl(keys.cover),
  ]);
  return { original, thumb, cover };
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

export function contentTypeFromMime(mime: string | undefined): string {
  if (!mime) return "image/jpeg";
  const m = mime.toLowerCase();
  if (m.includes("png")) return "image/png";
  if (m.includes("webp")) return "image/webp";
  if (m.includes("heic") || m.includes("heif")) return "image/heic";
  return "image/jpeg";
}
