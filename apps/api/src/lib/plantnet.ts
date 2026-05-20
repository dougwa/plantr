import { env } from "../env.js";

const PLANTNET_URL = "https://my-api.plantnet.org/v2/identify/all";
const MIN_CONFIDENCE = 0.9;

export type PlantNetResult = {
  scientificName: string;
  commonNames: string[];
  family: string | null;
  genus: string | null;
  score: number;
  raw: unknown;
};

export function plantNetEnabled(): boolean {
  // Temporarily disabled — identification quality wasn't producing useful
  // matches. Flip back on once we have a better strategy.
  return false;
}

export async function identifyFromBuffer(buffer: Buffer): Promise<PlantNetResult | null> {
  if (!plantNetEnabled()) return null;

  const form = new FormData();
  form.append("images", new Blob([buffer]), "photo.jpg");
  form.append("organs", "auto");

  const url = `${PLANTNET_URL}?api-key=${encodeURIComponent(env.PLANTNET_API_KEY!)}`;

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as
    | {
        results?: Array<{
          score: number;
          species: {
            scientificNameWithoutAuthor?: string;
            commonNames?: string[];
            family?: { scientificNameWithoutAuthor?: string };
            genus?: { scientificNameWithoutAuthor?: string };
          };
        }>;
      }
    | null;

  const top = data?.results?.[0];
  if (!top || top.score < MIN_CONFIDENCE) return null;

  return {
    scientificName: top.species.scientificNameWithoutAuthor ?? "",
    commonNames: top.species.commonNames ?? [],
    family: top.species.family?.scientificNameWithoutAuthor ?? null,
    genus: top.species.genus?.scientificNameWithoutAuthor ?? null,
    score: top.score,
    raw: top,
  };
}
