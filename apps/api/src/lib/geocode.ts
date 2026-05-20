/**
 * Address → (lat, lng) via Nominatim (OpenStreetMap). Free tier; usage policy
 * caps us at ~1 req/sec, which is fine for site create/update — we don't
 * batch-geocode anything.
 *
 * The User-Agent must identify the application per Nominatim's terms.
 */

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "PlantrAPI/0.1 (https://github.com/dougwa/plantr)";

export type GeocodeResult = {
  lat: number;
  lng: number;
};

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      // Nominatim can be slow under load — abort after 5s rather than block
      // the site-create request indefinitely.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const top = data[0];
    if (!top) return null;
    const lat = parseFloat(top.lat);
    const lng = parseFloat(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
