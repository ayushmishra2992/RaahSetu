import "dotenv/config";
import { defineConfig } from "vitest/config";

const testDb = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      // Integration tests only ever touch TEST_DATABASE_URL (wiped on every run).
      DATABASE_URL: testDb ?? "postgresql://unused:unused@localhost:5432/unused",
      JWT_SECRET: "test-only-secret-not-used-anywhere-else-0123456789",
      UPLOAD_DIR: "./.test-uploads",
      AUTH_RATE_LIMIT_PER_15_MIN: "1000",
      PUBLIC_APP_URL: "http://localhost:3000",
      // Tests never call a real location-search provider, even if backend/.env configures one.
      PLACES_PROVIDER: "none",
      PLACES_API_KEY: "",
      PLACES_FALLBACK_PROVIDER: "none",
      PLACES_FALLBACK_API_KEY: "",
      // Small pack cap so the size-limit behaviour is tested with ~1 MB of files.
      MAX_PACK_MB: "1",
    },
    projects: [
      {
        // Pure logic: never connects to a database, so it runs anywhere.
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          env: { DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused" },
        },
      },
      {
        // Resets TEST_DATABASE_URL before running (see tests/globalSetup.ts).
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/globalSetup.ts"],
        },
      },
    ],
  },
});
