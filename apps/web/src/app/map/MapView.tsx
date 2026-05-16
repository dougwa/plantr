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
import { tagKindStyle } from "@/lib/tagStyle";

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
    if (plantsWithGps.length > 0) {
      return plantsWithGps.map(
        (p) => [p.gpsLat as number, p.gpsLng as number] as [number, number],
      );
    }
    if (shapes.length > 0) {
      return shapes.map(
        (s) => [s.centerLat, s.centerLng] as [number, number],
      );
    }
    return null;
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

        {/* Property shapes first so location shapes layer above them. */}
        {shapes
          .filter((s) => s.kind === "property")
          .map((s) => (
            <Rectangle
              key={s.id}
              bounds={rectangleBounds(s)}
              pathOptions={{
                color: s.color,
                weight: 2,
                fillOpacity: 0,
                dashArray: "8 6",
              }}
            />
          ))}
        {shapes
          .filter((s) => s.kind !== "property")
          .map((s) =>
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
                {p.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.tags.map((t) => {
                      const style = tagKindStyle(t.kind);
                      return (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: style.color }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-2.5 w-2.5 fill-current"
                            aria-hidden="true"
                          >
                            <path d={style.iconPath} />
                          </svg>
                          {t.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
