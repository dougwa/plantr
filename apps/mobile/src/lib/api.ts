export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

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
  urls: {
    original: string;
    thumb: string;
    cover: string;
  };
};

export type PublicAction = {
  id: string;
  kind: ActionKind;
  notes: string | null;
  takenAt: string;
  createdAt: string;
  createdBy: { id: string; username: string };
};

export type PublicPlant = {
  id: string;
  qrCode: string;
  name: string | null;
  type: { id: string; name: string } | null;
  species: string | null;
  description: string | null;
  notes: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  plantNetData: unknown;
  locationShapeId: string | null;
  coverPhoto: PublicPhoto | null;
  photos: PublicPhoto[];
  actions: PublicAction[];
  createdBy: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
};

export type PlantType = { id: string; name: string };

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Result<T>> {
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body && !(init.body instanceof FormData) && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: body.error ?? `http_${res.status}` };
  }
  const data = (await res.json()) as T;
  return { ok: true, data };
}

export function photoUrl(token: string, urlPath: string): string {
  // For mobile we always need the bearer token, but RN <Image> doesn't pass headers
  // by default. We use the source.headers prop instead — see PhotoImage component.
  void token;
  return `${API_URL}${urlPath}`;
}

// --- auth -------------------------------------------------------------------

export async function login(username: string, password: string) {
  return request<{ token: string; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchMe(token: string) {
  const r = await request<{ user: AuthUser }>("/auth/me", { method: "GET", token });
  return r.ok ? r.data.user : null;
}

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
) {
  return request<{ ok: boolean }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
    token,
  });
}

export async function logout(token: string): Promise<void> {
  await request("/auth/logout", { method: "POST", token }).catch(() => {});
}

// --- plant types ------------------------------------------------------------

export async function listPlantTypes(token: string) {
  return request<{ types: PlantType[] }>("/plant-types", { method: "GET", token });
}

// --- plants -----------------------------------------------------------------

export async function getPlantByQr(token: string, code: string) {
  return request<{ plant: PublicPlant }>(`/plants/by-qr/${encodeURIComponent(code)}`, {
    method: "GET",
    token,
  });
}

export async function createPlant(
  token: string,
  body: { qrCode: string; gpsLat?: number; gpsLng?: number },
) {
  return request<{ plant: PublicPlant }>("/plants", {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function getPlant(token: string, id: string) {
  return request<{ plant: PublicPlant }>(`/plants/${id}`, { method: "GET", token });
}

export async function patchPlant(
  token: string,
  id: string,
  patch: Partial<{
    name: string | null;
    typeId: string | null;
    species: string | null;
    description: string | null;
    notes: string | null;
    gpsLat: number | null;
    gpsLng: number | null;
  }>,
) {
  return request<{ plant: PublicPlant }>(`/plants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    token,
  });
}

// --- photos -----------------------------------------------------------------

export async function uploadPhoto(token: string, plantId: string, fileUri: string) {
  const form = new FormData();
  form.append("file", {
    uri: fileUri,
    name: "photo.jpg",
    type: "image/jpeg",
  } as unknown as Blob);
  return request<{ photo: PublicPhoto }>(`/plants/${plantId}/photos`, {
    method: "POST",
    body: form,
    token,
  });
}

export async function setCoverPhoto(token: string, photoId: string) {
  return request<{ plant: PublicPlant }>(`/photos/${photoId}`, {
    method: "PATCH",
    body: JSON.stringify({ setCover: true }),
    token,
  });
}

export async function deletePhoto(token: string, photoId: string) {
  return request<{ ok: boolean }>(`/photos/${photoId}`, { method: "DELETE", token });
}

// --- actions ----------------------------------------------------------------

export async function recordAction(
  token: string,
  plantId: string,
  body: { kind: ActionKind; notes?: string },
) {
  return request<{ action: PublicAction }>(`/plants/${plantId}/actions`, {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}
