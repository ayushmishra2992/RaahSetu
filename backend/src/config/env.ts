import { config } from "dotenv";
import { z } from "zod";

config({ quiet: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (see backend/.env.example)"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters (see backend/.env.example)"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),
  // Document storage. "local" writes to UPLOAD_DIR (fine for development, NOT persistent on
  // Render's free plan); "s3" uses any S3-compatible private bucket (AWS S3, Cloudflare R2,
  // Backblaze B2, MinIO…). Nothing external is contacted unless STORAGE_DRIVER=s3.
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  /** Custom endpoint for non-AWS providers, e.g. https://<account>.r2.cloudflarestorage.com */
  S3_ENDPOINT: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Lifetime of signed document download links. */
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  /** Per-user limits for the memory-heavy document endpoints (uploads are buffered in memory). */
  UPLOAD_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
  PACK_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(6),
  /** Largest trip document pack built in memory; further files are listed as omitted in MANIFEST.txt. */
  MAX_PACK_MB: z.coerce.number().positive().max(500).default(50),
  AUTH_RATE_LIMIT_PER_15_MIN: z.coerce.number().int().positive().default(50),
  // Location search (optional). "none" keeps search off; the UI then uses the map pin / manual coordinates.
  PLACES_PROVIDER: z.enum(["none", "locationiq", "geoapify"]).default("none"),
  PLACES_API_KEY: z.string().optional(),
  // Optional second provider, used only when the first one fails (not when it finds nothing).
  PLACES_FALLBACK_PROVIDER: z.enum(["none", "locationiq", "geoapify"]).default("none"),
  PLACES_FALLBACK_API_KEY: z.string().optional(),
  PLACES_COUNTRY: z
    .string()
    .regex(/^[a-z]{2}$/, "PLACES_COUNTRY must be a two-letter lower-case country code")
    .default("in"),
  PLACES_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid backend environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  if (e.STORAGE_DRIVER === "s3") {
    const missing = (["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const).filter((k) => !e[k]);
    if (missing.length) throw new Error(`Invalid backend environment configuration:\n  - STORAGE_DRIVER=s3 requires ${missing.join(", ")}`);
  }
  return e;
}

export const env = loadEnv();
