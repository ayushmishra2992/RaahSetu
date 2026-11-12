/**
 * Review screenshots (not a test of behaviour). Skipped unless SCREENSHOT_DIR is set:
 *   SCREENSHOT_DIR=... SCREENSHOT_LABEL=after npx playwright test screenshots
 * Uses placeholder map tiles unless REAL_TILES=1 (keep real-tile runs occasional).
 */
import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

const DIR = process.env.SCREENSHOT_DIR;
const LABEL = process.env.SCREENSHOT_LABEL ?? "shot";
const ALL_PAGES: Array<[string, string]> = [
  ["dashboard", "/dashboard"],
  ["optiroute", "/optiroute"],
  ["run-detail", "/optiroute/runs/1"],
  ["compare", "/optiroute/compare?a=1&b=2"],
  ["orders", "/orders"],
  ["trips", "/trips"],
  ["trip-detail", "/trips/1"],
  ["trip-new", "/trips/new"],
  ["vehicles", "/vehicles"],
  ["vehicle-detail", "/vehicles/1"],
  ["drivers", "/drivers"],
  ["documents", "/documents"],
  ["locations", "/locations"],
  ["billing", "/billing"],
  ["billing-detail", "/billing/1"],
  ["greenfleet", "/greenfleet"],
  ["scenarios", "/scenarios"],
  ["scenario-detail", "/scenarios/1"],
  ["users", "/users"],
  ["audit", "/audit"],
  ["settings", "/settings"],
];
// SCREENSHOT_PAGES=dashboard,orders limits the run to those pages.
const ONLY = process.env.SCREENSHOT_PAGES?.split(",");
const PAGES = ONLY ? ALL_PAGES.filter(([n]) => ONLY.includes(n)) : ALL_PAGES;
const WIDTHS = (process.env.SCREENSHOT_WIDTHS ?? "1440,1024,768,390").split(",").map(Number);

test.skip(!DIR, "set SCREENSHOT_DIR to capture review screenshots");

for (const width of WIDTHS) {
  for (const [name, path] of PAGES) {
    test(`screenshot ${name} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await mockApi(page, { role: "ADMIN", realTiles: process.env.REAL_TILES === "1" });
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      if (await page.locator(".leaflet-container").count()) {
        await page.waitForFunction(() => [...document.querySelectorAll("img.leaflet-tile")].every((i) => (i as HTMLImageElement).complete));
      }
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      test.info().annotations.push({ type: "horizontal-overflow-px", description: String(overflow) });
      await page.screenshot({ path: `${DIR}/${LABEL}-${width}-${name}.png`, fullPage: true });
    });
  }
}
