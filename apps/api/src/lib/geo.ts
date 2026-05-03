import type { LocationShape } from "@prisma/client";

const METERS_PER_DEGREE_LAT = 111_320;

function toMetersOffset(lat: number, lng: number, centerLat: number, centerLng: number) {
  const dx = (lng - centerLng) * METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
  const dy = (lat - centerLat) * METERS_PER_DEGREE_LAT;
  return { dx, dy };
}

export function pointInShape(
  lat: number,
  lng: number,
  shape: Pick<
    LocationShape,
    "kind" | "centerLat" | "centerLng" | "widthMeters" | "heightMeters" | "rotationDegrees"
  >,
): boolean {
  // Property shapes are property-line markers, not plant location groups —
  // they never claim plants for assignment.
  if (shape.kind === "property") return false;

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
