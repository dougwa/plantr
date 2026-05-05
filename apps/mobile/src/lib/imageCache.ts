import * as FileSystem from "expo-file-system/legacy";

const CACHE_DIR = `${FileSystem.cacheDirectory}plantr-images/`;

let dirReady: Promise<void> | null = null;
function ensureDir() {
  if (!dirReady) {
    dirReady = (async () => {
      const info = await FileSystem.getInfoAsync(CACHE_DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      }
    })();
  }
  return dirReady;
}

function keyFor(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "_");
}

const inflight = new Map<string, Promise<string>>();
const memCache = new Map<string, string>(); // path -> file URI

export function getCachedImageUriSync(cacheKey: string): string | null {
  return memCache.get(cacheKey) ?? null;
}

export async function getCachedImageUri(
  remoteUrl: string,
  cacheKey: string,
  token: string,
): Promise<string> {
  const memHit = memCache.get(cacheKey);
  if (memHit) {
    if (__DEV__) console.log(`[imageCache] mem-hit ${cacheKey}`);
    return memHit;
  }

  await ensureDir();
  const fileUri = `${CACHE_DIR}${keyFor(cacheKey)}`;
  const info = await FileSystem.getInfoAsync(fileUri);
  if (info.exists) {
    if (__DEV__) console.log(`[imageCache] disk-hit ${cacheKey}`);
    memCache.set(cacheKey, fileUri);
    return fileUri;
  }

  let pending = inflight.get(fileUri);
  if (!pending) {
    const t0 = Date.now();
    pending = (async () => {
      try {
        const result = await FileSystem.downloadAsync(remoteUrl, fileUri, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (result.status < 200 || result.status >= 300) {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
          throw new Error(`Download failed: ${result.status}`);
        }
        memCache.set(cacheKey, fileUri);
        if (__DEV__) {
          console.log(
            `[imageCache] downloaded ${cacheKey} in ${Date.now() - t0}ms`,
          );
        }
        return fileUri;
      } finally {
        inflight.delete(fileUri);
      }
    })();
    inflight.set(fileUri, pending);
  }
  return pending;
}

export async function getImageCacheBytes(): Promise<number> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) return 0;
  const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
  let total = 0;
  for (const f of files) {
    const fInfo = await FileSystem.getInfoAsync(`${CACHE_DIR}${f}`);
    if (fInfo.exists && typeof fInfo.size === "number") total += fInfo.size;
  }
  return total;
}

export async function clearImageCache(): Promise<void> {
  dirReady = null;
  inflight.clear();
  memCache.clear();
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (info.exists) {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  }
}
