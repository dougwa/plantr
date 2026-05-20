import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { pointInShape } from "./geo.js";

type Tx = PrismaClient | Prisma.TransactionClient;

// Tag display name for a location-kind tag, falling back to a deterministic
// id-suffixed label so unnamed shapes still produce a unique, readable tag.
export function tagNameForShape(shapeId: string, shapeName: string | null): string {
  const trimmed = shapeName?.trim();
  if (trimmed) return trimmed;
  return `Location ${shapeId.slice(-6)}`;
}

// Returns `candidate` if no other location tag in the same site holds that
// name; otherwise appends a shape-id suffix to disambiguate. Used by shape
// create/rename so a collision between two same-named shapes inside a site
// doesn't break the (siteId, kind, name) unique constraint.
async function uniqueLocationTagName(
  tx: Tx,
  siteId: string,
  candidate: string,
  shapeId: string,
): Promise<string> {
  const clash = await tx.tag.findFirst({
    where: {
      siteId,
      kind: "location",
      name: candidate,
      NOT: { locationShapeId: shapeId },
    },
    select: { id: true },
  });
  if (!clash) return candidate;
  return `${candidate} (${shapeId.slice(-6)})`;
}

// Create the paired location tag for a freshly created shape.
export async function createLocationTagForShape(
  tx: Tx,
  shape: { id: string; name: string | null; siteId: string },
): Promise<void> {
  const name = await uniqueLocationTagName(
    tx,
    shape.siteId,
    tagNameForShape(shape.id, shape.name),
    shape.id,
  );
  await tx.tag.create({
    data: {
      name,
      kind: "location",
      locationShapeId: shape.id,
      siteId: shape.siteId,
    },
  });
}

// Sync the paired location tag's name to match a (possibly renamed) shape.
export async function syncLocationTagName(
  tx: Tx,
  shape: { id: string; name: string | null; siteId: string },
): Promise<void> {
  const desired = await uniqueLocationTagName(
    tx,
    shape.siteId,
    tagNameForShape(shape.id, shape.name),
    shape.id,
  );
  await tx.tag.updateMany({
    where: { locationShapeId: shape.id },
    data: { name: desired },
  });
}

// Returns the set of location-tag ids (within the given site) whose shape
// contains the given point.
export async function resolveLocationTagIdsForPoint(
  siteId: string,
  lat: number | null,
  lng: number | null,
): Promise<string[]> {
  if (lat == null || lng == null) return [];
  const tags = await prisma.tag.findMany({
    where: { siteId, kind: "location" },
    include: { locationShape: true },
  });
  const ids: string[] = [];
  for (const t of tags) {
    if (t.locationShape && pointInShape(lat, lng, t.locationShape)) {
      ids.push(t.id);
    }
  }
  return ids;
}

// Replace a plant's location-kind tags with whatever its GPS now resolves to,
// preserving any custom tags. No-op if the plant doesn't exist or already has
// the right set.
export async function syncPlantLocationTags(
  plantId: string,
  lat: number | null,
  lng: number | null,
): Promise<void> {
  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: { siteId: true, tags: { select: { id: true, kind: true } } },
  });
  if (!plant) return;
  const desired = new Set(await resolveLocationTagIdsForPoint(plant.siteId, lat, lng));
  const currentLoc = plant.tags.filter((t) => t.kind === "location").map((t) => t.id);
  const sameSet =
    currentLoc.length === desired.size && currentLoc.every((id) => desired.has(id));
  if (sameSet) return;
  const customIds = plant.tags.filter((t) => t.kind === "custom").map((t) => t.id);
  const next = [...customIds, ...desired];
  await prisma.plant.update({
    where: { id: plantId },
    data: { tags: { set: next.map((id) => ({ id })) } },
  });
}

// After a shape's geometry changes, every plant in the same site with GPS may
// have moved in or out of it. Re-sync everyone with GPS to the new world.
export async function reassignPlantsAfterShapeChange(siteId: string): Promise<void> {
  const plants = await prisma.plant.findMany({
    where: { siteId, gpsLat: { not: null }, gpsLng: { not: null } },
    select: { id: true, gpsLat: true, gpsLng: true },
  });
  for (const p of plants) {
    await syncPlantLocationTags(p.id, p.gpsLat, p.gpsLng);
  }
}
