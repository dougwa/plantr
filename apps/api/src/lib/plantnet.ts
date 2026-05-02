import { createReadStream } from "node:fs";
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
  return Boolean(env.PLANTNET_API_KEY);
}

export async function identifyFromFile(filePath: string): Promise<PlantNetResult | null> {
  if (!plantNetEnabled()) return null;

  const form = new FormData();
  const fileBlob = await fileToBlob(filePath);
  form.append("images", fileBlob, "photo.jpg");
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

async function fileToBlob(filePath: string): Promise<Blob> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(filePath)) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return new Blob([Buffer.concat(chunks)]);
}
