export const SESSION_COOKIE = "plantr_session";

const SERVER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthUser = {
  id: string;
  username: string;
  mustChangePass: boolean;
};

export type ActionKind = "feeding" | "watering" | "fertilizing" | "treating";

export type PublicPhoto = {
  id: string;
  createdAt: string;
  createdBy: { id: string; username: string };
  urls: { original: string; thumb: string; cover: string };
};

export type PublicAction = {
  id: string;
  kind: ActionKind;
  notes: string | null;
  takenAt: string;
  createdAt: string;
  createdBy: { id: string; username: string };
};

export type TagKind = "custom" | "location";

export type Tag = {
  id: string;
  name: string;
  kind: TagKind;
  locationShapeId: string | null;
};

export type PublicPlant = {
  id: string;
  qrCode: string;
  name: string | null;
  tags: Tag[];
  species: string | null;
  description: string | null;
  notes: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  plantNetData: unknown;
  coverPhoto: PublicPhoto | null;
  photos: PublicPhoto[];
  actions: PublicAction[];
  createdBy: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
};

export type PlantListItem = {
  id: string;
  qrCode: string;
  name: string | null;
  tags: Tag[];
  gpsLat: number | null;
  gpsLng: number | null;
  coverPhotoThumbUrl: string | null;
};

export type LocationShape = {
  id: string;
  name: string | null;
  kind: "rectangle" | "ellipse" | "property";
  color: string;
  centerLat: number;
  centerLng: number;
  widthMeters: number;
  heightMeters: number;
  rotationDegrees: number;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
};

async function apiFetch<T>(path: string, cookieHeader: string | undefined): Promise<T | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (res.status !== 200) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchMeServerSide(cookieHeader: string | undefined): Promise<AuthUser | null> {
  const data = await apiFetch<{ user: AuthUser }>("/auth/me", cookieHeader);
  return data?.user ?? null;
}

export async function fetchPlantServerSide(
  id: string,
  cookieHeader: string | undefined,
): Promise<PublicPlant | null> {
  const data = await apiFetch<{ plant: PublicPlant }>(`/plants/${id}`, cookieHeader);
  return data?.plant ?? null;
}

export async function fetchPlantsServerSide(
  cookieHeader: string | undefined,
): Promise<PlantListItem[]> {
  const data = await apiFetch<{ plants: PlantListItem[] }>("/plants", cookieHeader);
  return data?.plants ?? [];
}

export async function fetchLocationShapesServerSide(
  cookieHeader: string | undefined,
): Promise<LocationShape[]> {
  const data = await apiFetch<{ shapes: LocationShape[] }>("/location-shapes", cookieHeader);
  return data?.shapes ?? [];
}

// Photo URLs from the API are now absolute, pre-signed Spaces URLs — return as-is.
export function photoUrl(url: string): string {
  return url;
}
