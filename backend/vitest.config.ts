import "dotenv/config";
import { defineConfig } from "vitest/config";

const testDb = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
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
    },
  },
});
