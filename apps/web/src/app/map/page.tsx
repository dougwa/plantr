import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  fetchLocationShapesServerSide,
  fetchPlantsServerSide,
  SITE_COOKIE,
} from "@/lib/api";
import MapClient from "./MapClient";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const siteId = cookieStore.get(SITE_COOKIE)?.value;
  if (!siteId) redirect("/");

  const [plants, shapes] = await Promise.all([
    fetchPlantsServerSide(siteId, cookieHeader),
    fetchLocationShapesServerSide(siteId, cookieHeader),
  ]);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null;

  return (
    <main className="min-h-screen bg-neutral-50 flex flex-col">
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between text-sm">
          <Link href="/" className="text-neutral-600 hover:text-neutral-900">
            ← Home
          </Link>
          <span className="text-neutral-500">
            {plants.length} plants · {shapes.length} location{shapes.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="flex-1">
        <MapClient plants={plants} shapes={shapes} mapboxToken={mapboxToken} />
      </div>
    </main>
  );
}
