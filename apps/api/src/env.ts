import { z } from "zod";

const schema = z.object({
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  STORAGE_DIR: z.string().default("./storage"),
  AUTH_TOKEN_SECRET: z.string().min(8, "AUTH_TOKEN_SECRET must be set"),
  PLANTNET_API_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
