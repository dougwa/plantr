import * as Location from "expo-location";

export type GpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
};

export type GetAccurateGpsOptions = {
  // Hard cap on how long we wait for a fix. Default 6s.
  timeoutMs?: number;
  // Resolve early once a sample is at least this accurate. Default 5m.
  targetAccuracyMeters?: number;
  // Reject the best sample if it is worse than this. Default 20m. Pass
  // Infinity to accept whatever the OS produces (e.g. camera positioning).
  maxAccuracyMeters?: number;
};

// iOS getCurrentPositionAsync often returns a cached or low-accuracy fix.
// Streaming with watchPositionAsync gives Core Location time to lock onto
// satellites and Wi-Fi/cell triangulation, producing a tighter fix.
export async function getAccurateGps(
  opts: GetAccurateGpsOptions = {},
): Promise<GpsFix | null> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const targetAccuracy = opts.targetAccuracyMeters ?? 5;
  const maxAccuracy = opts.maxAccuracyMeters ?? 20;

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") return null;

  return new Promise<GpsFix | null>((resolve) => {
    let best: GpsFix | null = null;
    let settled = false;
    let subscription: Location.LocationSubscription | null = null;

    const finish = (fix: GpsFix | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      resolve(fix);
    };

    const timer = setTimeout(() => {
      finish(best && best.accuracy <= maxAccuracy ? best : null);
    }, timeoutMs);

    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 500,
        distanceInterval: 0,
      },
      (loc) => {
        const { latitude, longitude, accuracy } = loc.coords;
        if (accuracy == null) return;
        if (best == null || accuracy < best.accuracy) {
          best = { lat: latitude, lng: longitude, accuracy };
        }
        if (accuracy <= targetAccuracy) finish(best);
      },
    )
      .then((sub) => {
        if (settled) {
          sub.remove();
          return;
        }
        subscription = sub;
      })
      .catch((err) => {
        console.warn("watchPositionAsync failed", err);
        finish(best && best.accuracy <= maxAccuracy ? best : null);
      });
  });
}
