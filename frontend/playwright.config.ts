import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against `next dev` with every /api/* call answered by
 * in-browser fixtures (e2e/fixtures), so no backend or database is needed.
 * An already-running dev server on :3000 is reused; set E2E_BASE_URL to test
 * another server instead (e.g. a production build via `next start`).
 *
 * Browser: Playwright's Chromium by default (`npx playwright install chromium`);
 * set PLAYWRIGHT_CHANNEL=msedge or chrome to use an installed browser instead.
 */
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel } }],
  // With E2E_BASE_URL (e.g. a `next start` production server) no server is launched.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
