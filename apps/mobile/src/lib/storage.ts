import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "plantr.token";
const CURRENT_SITE_KEY = "plantr.currentSiteId";
const VIEWPORT_KEY = "plantr.mapViewport";

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function saveCurrentSiteId(id: string | null): Promise<void> {
  if (id == null) {
    await SecureStore.deleteItemAsync(CURRENT_SITE_KEY).catch(() => {});
    return;
  }
  await SecureStore.setItemAsync(CURRENT_SITE_KEY, id);
}

export async function loadCurrentSiteId(): Promise<string | null> {
  return SecureStore.getItemAsync(CURRENT_SITE_KEY);
}

export type SavedViewport = {
  center: { latitude: number; longitude: number };
  pitch: number;
  heading: number;
  zoom?: number;
  altitude?: number;
};

export async function saveViewport(v: SavedViewport): Promise<void> {
  try {
    await SecureStore.setItemAsync(VIEWPORT_KEY, JSON.stringify(v));
  } catch {
    // best-effort
  }
}

export async function loadViewport(): Promise<SavedViewport | null> {
  try {
    const raw = await SecureStore.getItemAsync(VIEWPORT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedViewport;
  } catch {
    return null;
  }
}
