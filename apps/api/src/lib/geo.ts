import type { LocationShape } from "@prisma/client";

const METERS_PER_DEGREE_LAT = 111_320;

function toMetersOffset(lat: number, lng: number, centerLat: number, centerLng: number) {
  const dx = (lng - centerLng) * METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
  const dy = (lat - centerLat) * METERS_PER_DEGREE_LAT;
  return { dx, dy };
}

function pointInPolygon(
  lat: number,
  lng: number,
  pts: Array<{ lat: number; lng: number }>,
): boolean {
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]!.lng;
    const yi = pts[i]!.lat;
    const xj = pts[j]!.lng;
    const yj = pts[j]!.lat;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function isPolygonPointArray(v: unknown): v is Array<{ lat: number; lng: number }> {
  return (
    Array.isArray(v) &&
    v.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as { lat?: unknown }).lat === "number" &&
        typeof (p as { lng?: unknown }).lng === "number",
    )
  );
}

export function pointInShape(
  lat: number,
  lng: number,
  shape: Pick<
    LocationShape,
    | "kind"
    | "centerLat"
    | "centerLng"
    | "widthMeters"
    | "heightMeters"
    | "rotationDegrees"
    | "polygonPoints"
  >,
): boolean {
  // Property shapes are property-line markers, not plant location groups —
  // they never claim plants for assignment.
  if (shape.kind === "property") return false;

  if (shape.kind === "polygon") {
    return isPolygonPointArray(shape.polygonPoints)
      ? pointInPolygon(lat, lng, shape.polygonPoints)
      : false;
  }

  let { dx, dy } = toMetersOffset(lat, lng, shape.centerLat, shape.centerLng);

  if (shape.rotationDegrees !== 0) {
    const t = (-shape.rotationDegrees * Math.PI) / 180;
    const rx = dx * Math.cos(t) - dy * Math.sin(t);
    const ry = dx * Math.sin(t) + dy * Math.cos(t);
    dx = rx;
    dy = ry;
  }

  const halfW = shape.widthMeters / 2;
  const halfH = shape.heightMeters / 2;

  if (shape.kind === "ellipse") {
    return (dx / halfW) ** 2 + (dy / halfH) ** 2 <= 1;
  }
  // default: rectangle
  return Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
}
