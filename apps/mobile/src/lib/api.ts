export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://plantr.kauseway.com/api";

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  mustChangePass: boolean;
  mustCompleteProfile: boolean;
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

// --- current-site context ---------------------------------------------------
//
// Every tenanted endpoint now lives under /sites/:siteId/*. We keep the "which
// site am I in?" state at module scope so individual screens don't need to
// thread it through every call — AuthContext is responsible for keeping this
// in sync (set after login/refresh, clear on signOut). Phase 5 wires the
// site selector to call setCurrentSiteId.

let currentSiteId: string | null = null;

export function setCurrentSiteId(id: string | null): void {
  currentSiteId = id;
}

export function getCurrentSiteId(): string | null {
  return currentSiteId;
}

function sitePath(suffix: string): string {
  if (!currentSiteId) {
    throw new Error("no_site_selected");
  }
  return `/sites/${encodeURIComponent(currentSiteId)}${suffix}`;
}

// --- sites ------------------------------------------------------------------

export type SiteRole = "OWNER" | "ADMIN" | "USER" | "VIEWER";

export type SiteSummary = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  visibility: "PUBLIC" | "PRIVATE";
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; username: string; name: string | null };
  role: SiteRole;
};

export async function listSites(token: string) {
  return request<{ sites: SiteSummary[] }>("/sites", { method: "GET", token });
}

export async function createSite(
  token: string,
  body: { name: string; address?: string; visibility?: "PUBLIC" | "PRIVATE" },
) {
  return request<{ site: SiteSummary }>("/sites", {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function patchSite(
  token: string,
  siteId: string,
  body: { name?: string; address?: string | null; visibility?: "PUBLIC" | "PRIVATE" },
) {
  return request<{ site: SiteSummary }>(`/sites/${encodeURIComponent(siteId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    token,
  });
}

export async function deleteSite(token: string, siteId: string) {
  return request<{ site: SiteSummary }>(`/sites/${encodeURIComponent(siteId)}`, {
    method: "DELETE",
    token,
  });
}

export async function joinPublicSite(token: string, siteId: string) {
  return request<{ site: SiteSummary; role: "VIEWER" }>(
    `/sites/${encodeURIComponent(siteId)}/join`,
    { method: "POST", token },
  );
}

export async function leaveSite(token: string, siteId: string, userId: string) {
  return request<{ ok: boolean }>(
    `/sites/${encodeURIComponent(siteId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE", token },
  );
}

export type PublicSiteSearchResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  visibility: "PUBLIC";
  createdAt: string;
  updatedAt: string;
  owner: { id: string; username: string; name: string | null };
  distanceKm: number | null;
};

export async function searchPublicSites(
  token: string,
  params: { q?: string; lat?: number; lng?: number; radiusKm?: number; limit?: number },
) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.lat !== undefined) qs.set("lat", String(params.lat));
  if (params.lng !== undefined) qs.set("lng", String(params.lng));
  if (params.radiusKm !== undefined) qs.set("radiusKm", String(params.radiusKm));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const tail = qs.toString();
  return request<{ sites: PublicSiteSearchResult[] }>(
    `/sites/public/search${tail ? `?${tail}` : ""}`,
    { method: "GET", token },
  );
}

export type SiteMember = {
  id: string;
  siteId: string;
  role: SiteRole;
  createdAt: string;
  user: { id: string; username: string; name: string | null; email: string | null };
};

export async function listSiteMembers(token: string, siteId: string) {
  return request<{ members: SiteMember[] }>(
    `/sites/${encodeURIComponent(siteId)}/members`,
    { method: "GET", token },
  );
}

// --- invitations ------------------------------------------------------------

export type InvitationSummary = {
  id: string;
  siteId: string;
  role: SiteRole;
  email: string | null;
  phone: string | null;
  token: string;
  invitedBy: { id: string; username: string; name: string | null };
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdAt: string;
};

export async function listInvitations(token: string, siteId: string) {
  return request<{ invitations: InvitationSummary[] }>(
    `/sites/${encodeURIComponent(siteId)}/invitations`,
    { method: "GET", token },
  );
}

export async function createInvitation(
  token: string,
  siteId: string,
  body: {
    role: SiteRole;
    email?: string;
    phone?: string;
    expiresInHours?: number;
  },
) {
  return request<{ invitation: InvitationSummary }>(
    `/sites/${encodeURIComponent(siteId)}/invitations`,
    {
      method: "POST",
      body: JSON.stringify(body),
      token,
    },
  );
}

export async function deleteInvitation(token: string, siteId: string, invitationId: string) {
  return request<{ ok: boolean }>(
    `/sites/${encodeURIComponent(siteId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE", token },
  );
}

export async function transferSiteOwnership(token: string, siteId: string, toUserId: string) {
  return request<{ invitation: InvitationSummary }>(
    `/sites/${encodeURIComponent(siteId)}/transfer`,
    {
      method: "POST",
      body: JSON.stringify({ toUserId }),
      token,
    },
  );
}

export async function acceptInvitation(token: string, invitationToken: string) {
  return request<{ site: { id: string; name: string }; role: SiteRole }>(
    `/invitations/${encodeURIComponent(invitationToken)}/accept`,
    { method: "POST", token },
  );
}

// --- notifications ----------------------------------------------------------

export type NotificationItem = {
  id: string;
  kind:
    | "invitation_received"
    | "invitation_accepted"
    | "ownership_offer"
    | (string & {});
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications(token: string) {
  return request<{ notifications: NotificationItem[] }>("/notifications", {
    method: "GET",
    token,
  });
}

export async function unreadNotificationCount(token: string) {
  return request<{ count: number }>("/notifications/unread-count", {
    method: "GET",
    token,
  });
}

export async function markNotificationsRead(
  token: string,
  body: { ids?: string[]; all?: boolean },
) {
  return request<{ updated: number }>("/notifications/mark-read", {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

// --- auth -------------------------------------------------------------------

export async function login(identifier: string, password: string) {
  // The API accepts either `email` or `username` (legacy) — pick based on
  // whether the user typed something that looks like an email.
  const body = identifier.includes("@")
    ? { email: identifier, password }
    : { username: identifier, password };
  return request<{ token: string; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function signup(email: string, password: string, name?: string) {
  return request<{ token: string; user: AuthUser }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
}

export async function oauthApple(
  identityToken: string,
  fullName?: { givenName: string | null; familyName: string | null } | null,
) {
  return request<{ token: string; user: AuthUser }>("/auth/oauth/apple", {
    method: "POST",
    body: JSON.stringify({ identityToken, fullName: fullName ?? undefined }),
  });
}

export async function oauthGoogle(idToken: string) {
  return request<{ token: string; user: AuthUser }>("/auth/oauth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
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

export async function completeProfile(
  token: string,
  body: { email: string; name?: string; newPassword?: string },
) {
  return request<{ user: AuthUser }>("/auth/complete-profile", {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function logout(token: string): Promise<void> {
  await request("/auth/logout", { method: "POST", token }).catch(() => {});
}

// --- tags -------------------------------------------------------------------

export async function listTags(token: string) {
  return request<{ tags: Tag[] }>(sitePath("/tags"), { method: "GET", token });
}

export async function createTag(token: string, body: { name: string }) {
  return request<{ tag: Tag }>(sitePath("/tags"), {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function updateTag(
  token: string,
  id: string,
  body: { name?: string },
) {
  return request<{ tag: Tag }>(sitePath(`/tags/${id}`), {
    method: "PATCH",
    body: JSON.stringify(body),
    token,
  });
}

export async function deleteTag(token: string, id: string) {
  return request<{ ok: boolean }>(sitePath(`/tags/${id}`), { method: "DELETE", token });
}

// --- plants -----------------------------------------------------------------

export async function getPlantByQr(token: string, code: string) {
  return request<{ plant: PublicPlant }>(
    sitePath(`/plants/by-qr/${encodeURIComponent(code)}`),
    { method: "GET", token },
  );
}

export type CodeLookup =
  | { type: "plant"; plant: PublicPlant }
  | { type: "shape"; shape: LocationShape };

export async function lookupCode(token: string, code: string) {
  return request<CodeLookup>(sitePath(`/codes/by-qr/${encodeURIComponent(code)}`), {
    method: "GET",
    token,
  });
}

export async function createPlant(
  token: string,
  body: { qrCode: string; gpsLat?: number; gpsLng?: number },
) {
  return request<{ plant: PublicPlant }>(sitePath("/plants"), {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function getPlant(token: string, id: string) {
  return request<{ plant: PublicPlant }>(sitePath(`/plants/${id}`), {
    method: "GET",
    token,
  });
}

export async function patchPlant(
  token: string,
  id: string,
  patch: Partial<{
    name: string | null;
    tagIds: string[];
    species: string | null;
    description: string | null;
    notes: string | null;
    gpsLat: number | null;
    gpsLng: number | null;
  }>,
) {
  return request<{ plant: PublicPlant }>(sitePath(`/plants/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
    token,
  });
}

export async function resetPlant(token: string, id: string) {
  return request<{ plant: PublicPlant }>(sitePath(`/plants/${id}/reset`), {
    method: "POST",
    token,
  });
}

export async function deletePlant(token: string, id: string) {
  return request<{ ok: boolean }>(sitePath(`/plants/${id}`), {
    method: "DELETE",
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
  return request<{ photo: PublicPhoto }>(sitePath(`/plants/${plantId}/photos`), {
    method: "POST",
    body: form,
    token,
  });
}

export async function setCoverPhoto(token: string, photoId: string) {
  return request<{ plant: PublicPlant }>(sitePath(`/photos/${photoId}`), {
    method: "PATCH",
    body: JSON.stringify({ setCover: true }),
    token,
  });
}

export async function deletePhoto(token: string, photoId: string) {
  return request<{ ok: boolean }>(sitePath(`/photos/${photoId}`), {
    method: "DELETE",
    token,
  });
}

// --- actions ----------------------------------------------------------------

export async function recordAction(
  token: string,
  plantId: string,
  body: { kind: ActionKind; notes?: string },
) {
  return request<{ action: PublicAction }>(sitePath(`/plants/${plantId}/actions`), {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function patchAction(
  token: string,
  id: string,
  body: { notes: string | null },
) {
  return request<{ action: PublicAction }>(sitePath(`/actions/${id}`), {
    method: "PATCH",
    body: JSON.stringify(body),
    token,
  });
}

export async function deleteAction(token: string, id: string) {
  return request<{ ok: boolean }>(sitePath(`/actions/${id}`), {
    method: "DELETE",
    token,
  });
}

// --- plants list (lightweight) ---------------------------------------------

export type PlantListItem = {
  id: string;
  qrCode: string;
  name: string | null;
  tags: Tag[];
  species: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  coverPhotoThumbUrl: string | null;
};

export async function listPlants(token: string) {
  return request<{ plants: PlantListItem[] }>(sitePath("/plants"), { method: "GET", token });
}

// --- location shapes --------------------------------------------------------

export type LocationShape = {
  id: string;
  qrCode: string | null;
  name: string | null;
  kind: "rectangle" | "ellipse" | "property" | "polygon";
  color: string;
  centerLat: number;
  centerLng: number;
  widthMeters: number;
  heightMeters: number;
  rotationDegrees: number;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  polygonPoints?: Array<{ lat: number; lng: number }>;
};

export async function listLocationShapes(token: string) {
  return request<{ shapes: LocationShape[] }>(sitePath("/location-shapes"), {
    method: "GET",
    token,
  });
}

export async function createLocationShape(
  token: string,
  body: {
    name?: string | null;
    kind: "rectangle" | "ellipse" | "property" | "polygon";
    color: string;
    centerLat: number;
    centerLng: number;
    widthMeters: number;
    heightMeters: number;
    polygonPoints?: Array<{ lat: number; lng: number }>;
  },
) {
  return request<{ shape: LocationShape }>(sitePath("/location-shapes"), {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function patchLocationShape(
  token: string,
  id: string,
  patch: Partial<LocationShape>,
) {
  return request<{ shape: LocationShape }>(sitePath(`/location-shapes/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
    token,
  });
}

export async function deleteLocationShape(token: string, id: string) {
  return request<{ ok: boolean }>(sitePath(`/location-shapes/${id}`), {
    method: "DELETE",
    token,
  });
}
