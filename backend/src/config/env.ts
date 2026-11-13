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
  return parsed.data;
}

export const env = loadEnv();
