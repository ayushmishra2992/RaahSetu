/**
 * Bundle-weight guard against the production build: JavaScript a page loads
 * (encoded bytes on the wire) and whether Leaflet is fetched only where a map
 * is shown. Run with E2E_BASE_URL pointing at `next start`; dev builds are
 * unminified, so the budget is skipped there.
 */
import { expect, test } from "./fixtures/test";

const PAGES: Array<[string, boolean]> = [
  ["/dashboard", true],
  ["/orders", false],
  ["/trips/1", true],
  ["/optiroute", false],
  ["/optiroute/runs/1", true],
  ["/vehicles", false],
  ["/documents", false],
  ["/billing/1", false],
  ["/settings", false],
];

// Compressed JS per page, including the code Next.js prefetches for visible
// sidebar links. Leaflet is loaded on demand on map pages only.
const BUDGET_KB = 450;

test.describe("JavaScript weight", () => {
  test.skip(process.env.E2E_PRODUCTION !== "1", "budgets apply to the production build only (set E2E_PRODUCTION=1)");
  for (const [path, hasMap] of PAGES) {
    test(`${path} stays within ${BUDGET_KB} KB of JS${hasMap ? "" : " and does not load Leaflet"}`, async ({ page }) => {
      const pending: Array<Promise<number>> = [];
      page.on("requestfinished", (req) => {
        // Encoded (compressed) body size: what actually crosses the network.
        if (req.resourceType() === "script") pending.push(req.sizes().then((s) => s.responseBodySize));
      });
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const sizes = await Promise.all(pending);
      const totalKb = sizes.reduce((a, b) => a + b, 0) / 1024;
      test.info().annotations.push({ type: "js-kb-compressed", description: totalKb.toFixed(1) });
      console.log(`${path}: ${totalKb.toFixed(1)} KB JS (compressed, incl. route prefetch) in ${sizes.length} files`);
      expect(totalKb).toBeLessThan(BUDGET_KB);
      const leaflet = await page.evaluate(() => typeof (window as unknown as { L?: unknown }).L !== "undefined" || !!document.querySelector(".leaflet-container"));
      if (!hasMap) expect(leaflet, "Leaflet should not load on pages without a map").toBe(false);
    });
  }
});
