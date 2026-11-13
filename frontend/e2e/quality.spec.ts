/**
 * Release-readiness sweep over every page: structure and naming checks that
 * catch common accessibility regressions, layout overflow at phone, tablet and
 * small-laptop widths, and console errors. Not a substitute for a full WCAG
 * audit (no colour-contrast engine is bundled).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";

const APP_PAGES = [
  "/dashboard",
  "/orders",
  "/trips",
  "/trips/1",
  "/trips/new",
  "/optiroute",
  "/optiroute/runs/1",
  "/optiroute/compare?a=1&b=2",
  "/scenarios",
  "/scenarios/1",
  "/vehicles",
  "/vehicles/1",
  "/drivers",
  "/drivers/1",
  "/documents",
  "/locations",
  "/greenfleet",
  "/billing",
  "/billing/1",
  "/users",
  "/audit",
  "/settings",
];

/** Interactive or labelable elements that have no accessible name. */
async function unnamed(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden";
    };
    const nameOf = (el: Element) => {
      const aria = el.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      const id = el.getAttribute("id");
      if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim()) return "label";
      if (el.closest("label")?.textContent?.trim()) return "wrapped";
      if (el.getAttribute("title")?.trim()) return "title";
      if ((el as HTMLInputElement).placeholder?.trim() && el.tagName === "INPUT") return "placeholder";
      if (el.tagName === "A" || el.tagName === "BUTTON") {
        const text = el.textContent?.trim();
        const img = el.querySelector("img[alt]")?.getAttribute("alt")?.trim();
        return text || img || "";
      }
      return "";
    };
    const els = [...document.querySelectorAll("main a[href], main button, main input:not([type=hidden]), main select, main textarea, dialog a[href], dialog button, dialog input:not([type=hidden]), dialog select, dialog textarea")];
    return els.filter(visible).filter((el) => !nameOf(el)).map((el) => el.outerHTML.slice(0, 140));
  });
}

test.describe("every page", () => {
  for (const path of APP_PAGES) {
    test(`${path}: one h1, named controls, images with alt, lang`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && !/tile\.openstreetmap|favicon/.test(m.text()) && errors.push(m.text()));
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.locator("h1").count(), "exactly one h1").toBe(1);
      expect(await page.getAttribute("html", "lang")).toBe("en");
      expect(await unnamed(page), "controls without an accessible name").toEqual([]);
      expect(await page.locator("img:not([alt])").count(), "images without alt").toBe(0);
      expect(errors, "console errors").toEqual([]);
    });
  }
});

for (const width of [768, 1024]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const path of APP_PAGES) {
      test(`${path} has no horizontal page overflow`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("main h1").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe("public pages", () => {
  test.use({ role: null });
  for (const path of ["/", "/login", "/register"]) {
    test(`${path}: one h1, named controls, no overflow on phones`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await page.locator("h1").count()).toBe(1);
      const unnamedControls = await page.evaluate(() =>
        [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
          .filter((el) => !(el.getAttribute("aria-label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label")))
          .map((el) => el.outerHTML.slice(0, 120)),
      );
      expect(unnamedControls).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("security-sensitive frontend behaviour", () => {
  test("responses carry the hardening headers", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers()["x-powered-by"]).toBeUndefined();
  });

  test("links that open a new tab don't expose window.opener", async ({ page }) => {
    for (const path of ["/trips/1", "/billing/1"]) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      if (path === "/trips/1") await page.getByRole("button", { name: "Trip QR" }).click();
      const unsafe = await page.evaluate(() => [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !/noopener|noreferrer/.test(a.getAttribute("rel") ?? "")).length);
      expect(unsafe, path).toBe(0);
    }
  });
});
