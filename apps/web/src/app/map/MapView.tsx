"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Popup,
  Rectangle,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationShape, PlantListItem } from "@/lib/api";

const DEFAULT_CENTER: LatLngExpression = [47.61, -122.34];
const DEFAULT_ZOOM = 18;
const METERS_PER_DEGREE_LAT = 111_320;

type Props = {
  plants: PlantListItem[];
  shapes: LocationShape[];
  mapboxToken: string | null;
};

function FitToData({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 20 });
  }, [bounds, map]);
  return null;
}

function rectangleBounds(shape: LocationShape): LatLngBoundsExpression {
  const halfH = shape.heightMeters / 2 / METERS_PER_DEGREE_LAT;
  const halfW =
    shape.widthMeters /
    2 /
    (METERS_PER_DEGREE_LAT * Math.cos((shape.centerLat * Math.PI) / 180));
  return [
    [shape.centerLat - halfH, shape.centerLng - halfW],
    [shape.centerLat + halfH, shape.centerLng + halfW],
  ];
}

function ellipsePoints(shape: LocationShape, segments = 48): LatLngExpression[] {
  const halfH = shape.heightMeters / 2 / METERS_PER_DEGREE_LAT;
  const halfW =
    shape.widthMeters /
    2 /
    (METERS_PER_DEGREE_LAT * Math.cos((shape.centerLat * Math.PI) / 180));
  const points: LatLngExpression[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * 2 * Math.PI;
    points.push([
      shape.centerLat + halfH * Math.sin(t),
      shape.centerLng + halfW * Math.cos(t),
    ]);
  }
  return points;
}

export default function MapView({ plants, shapes, mapboxToken }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const plantsWithGps = useMemo(
    () => plants.filter((p) => p.gpsLat != null && p.gpsLng != null),
    [plants],
  );

  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    const points: [number, number][] = [];
    for (const p of plantsWithGps) {
      points.push([p.gpsLat as number, p.gpsLng as number]);
    }
    for (const s of shapes) {
      points.push([s.centerLat, s.centerLng]);
    }
    if (points.length === 0) return null;
    return points;
  }, [plantsWithGps, shapes]);

  const tileUrl = mapboxToken
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/{z}/{x}/{y}?access_token=${encodeURIComponent(mapboxToken)}`
    : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  const tileAttribution = mapboxToken
    ? '© <a href="https://www.mapbox.com/">Mapbox</a> © <a href="https://www.openstreetmap.org/">OSM</a>'
    : "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

  return (
    <div ref={containerRef} className="h-[calc(100vh-49px)] w-full">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer attribution={tileAttribution} url={tileUrl} maxZoom={22} maxNativeZoom={19} />
        <FitToData bounds={bounds} />

        {shapes.map((s) =>
          s.kind === "ellipse" ? (
            <Polygon
              key={s.id}
              positions={ellipsePoints(s)}
              pathOptions={{
                color: s.color,
                weight: 2,
                fillOpacity: 0.2,
              }}
            />
          ) : (
            <Rectangle
              key={s.id}
              bounds={rectangleBounds(s)}
              pathOptions={{
                color: s.color,
                weight: 2,
                fillOpacity: 0.2,
              }}
            />
          ),
        )}

        {plantsWithGps.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.gpsLat as number, p.gpsLng as number]}
            radius={6}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: "#16a34a",
              fillOpacity: 1,
            }}
            eventHandlers={{
              click: () => router.push(`/plants/${p.id}`),
            }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-medium">{p.name ?? "Unnamed"}</div>
                <div className="text-neutral-500 text-xs">{p.qrCode}</div>
                {p.type && <div className="text-neutral-700 text-xs mt-1">{p.type.name}</div>}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
