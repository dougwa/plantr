import { z } from "zod";

const schema = z.object({
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  AUTH_TOKEN_SECRET: z.string().min(8, "AUTH_TOKEN_SECRET must be set"),
  PLANTNET_API_KEY: z.string().optional(),

  // DigitalOcean Spaces (S3-compatible) photo storage.
  SPACES_REGION: z.string().min(1),
  SPACES_BUCKET: z.string().min(1),
  SPACES_ACCESS_KEY_ID: z.string().min(1),
  SPACES_SECRET_ACCESS_KEY: z.string().min(1),
  // When true, signed read URLs point at the Spaces CDN edge.
  SPACES_CDN_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("true")
    .transform((v) => v === "true"),
  // Signed-URL lifetime. Spaces caps at 7 days (604800s); default 24h.
  SPACES_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().max(604800).default(86400),

  // Used only by the one-shot migration script.
  STORAGE_DIR: z.string().default("./storage"),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
