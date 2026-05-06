import type { LocationShape, PlantListItem } from "./api";

const METERS_PER_DEGREE_LAT = 111_320;

export function latLngToLocal(
  shape: LocationShape,
  lat: number,
  lng: number,
): { x: number; y: number } {
  const cosLat = Math.cos((shape.centerLat * Math.PI) / 180);
  const xWorld = (lng - shape.centerLng) * METERS_PER_DEGREE_LAT * cosLat;
  const yWorld = (lat - shape.centerLat) * METERS_PER_DEGREE_LAT;
  const theta = (shape.rotationDegrees * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return {
    x: xWorld * cosT + yWorld * sinT,
    y: -xWorld * sinT + yWorld * cosT,
  };
}

export function pointInShape(
  shape: LocationShape,
  lat: number,
  lng: number,
): boolean {
  const local = latLngToLocal(shape, lat, lng);
  const halfW = shape.widthMeters / 2;
  const halfH = shape.heightMeters / 2;
  if (shape.kind === "ellipse") {
    const rx = local.x / halfW;
    const ry = local.y / halfH;
    return rx * rx + ry * ry <= 1;
  }
  return Math.abs(local.x) <= halfW && Math.abs(local.y) <= halfH;
}

// Returns the set of shape ids that "contain" the plant. A plant with GPS
// belongs to every shape whose geometry covers its coordinates (so overlapping
// shapes both list it). The plant's explicit locationShapeId is always
// included so manual assignments aren't lost when GPS is missing or stale.
export function shapeIdsForPlant(
  plant: PlantListItem,
  shapes: LocationShape[],
): Set<string> {
  const ids = new Set<string>();
  if (plant.locationShapeId) ids.add(plant.locationShapeId);
  if (plant.gpsLat != null && plant.gpsLng != null) {
    for (const s of shapes) {
      if (pointInShape(s, plant.gpsLat, plant.gpsLng)) ids.add(s.id);
    }
  }
  return ids;
}
