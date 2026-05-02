"use client";

import dynamic from "next/dynamic";
import type { LocationShape, PlantListItem } from "@/lib/api";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="h-[calc(100vh-49px)] w-full flex items-center justify-center bg-neutral-100 text-neutral-500">
      Loading map…
    </div>
  ),
});

export default function MapClient(props: {
  plants: PlantListItem[];
  shapes: LocationShape[];
  mapboxToken: string | null;
}) {
  return <MapView {...props} />;
}
