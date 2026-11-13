import { permissionsFor } from "../../backend/src/lib/permissions";
import { NAV } from "../src/lib/nav";
import type { Role } from "./fixtures/data";
import { expect, test } from "./fixtures/test";

const ROLES: Role[] = ["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE", "DRIVER"];

/** What the sidebar should show for a role, derived from the backend's permission matrix. */
function expectedNav(role: Role) {
  const perms = new Set<string>(permissionsFor(role));
  return NAV.flatMap((g) => g.items.filter((i) => !i.permission || perms.has(i.permission)));
}

test.describe("navigation", () => {
  test("every sidebar destination opens with a heading, breadcrumb and active state", async ({ page }) => {
    // 14 destinations; under `next dev` each route compiles on its first visit.
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const sidebar = page.getByRole("navigation", { name: "Main" });
    for (const item of NAV.flatMap((g) => g.items)) {
      await sidebar.getByRole("link", { name: item.label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${item.href}$`), { timeout: 30_000 });
      await expect(page.locator("main h1").first()).toBeVisible();
      await expect(sidebar.getByRole("link", { name: item.label, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText(item.label);
      await expect(page).toHaveTitle(`${item.label} · RaahSetu`);
    }
  });

  test("breadcrumbs describe sub-pages and link back to the section", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/trips/1");
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("listitem")).toHaveText(["Operations", "Trips & Dispatch", "Trip details"]);
    await crumbs.getByRole("link", { name: "Trips & Dispatch" }).click();
    await expect(page).toHaveURL(/\/trips$/);
  });
});

test.describe("role restrictions", () => {
  for (const role of ROLES) {
    test.describe(role, () => {
      test.use({ role });
      test(`${role} sees exactly the navigation their permissions allow`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/settings");
        const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
        await expect(links).toHaveText(expectedNav(role).map((i) => i.label));
      });
    });
  }

  test.describe("employee (read-only)", () => {
    test.use({ role: "EMPLOYEE" });
    test("has no create or edit actions on operational pages", async ({ page }) => {
      await page.goto("/orders");
      await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
      await expect(page.getByRole("button", { name: "New order" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
      await page.goto("/vehicles");
      await expect(page.getByRole("heading", { level: 1, name: "Vehicles" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add vehicle" })).toHaveCount(0);
    });
  });

  test.describe("driver", () => {
    test.use({ role: "DRIVER" });
    test("sees their own trips and only trip-progress actions", async ({ page }) => {
      await page.goto("/trips");
      await expect(page.getByRole("heading", { level: 1, name: "My trips" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Create trip manually" })).toHaveCount(0);
      await page.goto("/trips/1");
      await expect(page.getByRole("button", { name: "Complete trip" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Abort trip" })).toHaveCount(0);
    });
  });

  test.describe("dispatcher", () => {
    test.use({ role: "DISPATCHER" });
    test("cannot reach admin pages from the menu but can plan and create orders", async ({ page }) => {
      await page.goto("/orders");
      await expect(page.getByRole("button", { name: "New order" })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "OptiRoute" })).toBeVisible();
    });
  });
});

test.describe("page access by role", () => {
  for (const role of ROLES) {
    test.describe(role, () => {
      test.use({ role });
      test("permitted pages render; others show 'no access' without calling their API", async ({ page, api }) => {
        test.setTimeout(120_000);
        const perms = new Set<string>(permissionsFor(role));
        const pages = [...NAV.flatMap((g) => g.items.map((i) => ({ href: i.href, permission: i.permission }))), { href: "/trips/new", permission: "trips:write" }];
        for (const p of pages) {
          const before = api.requests.length;
          await page.goto(p.href);
          const allowed = !p.permission || perms.has(p.permission);
          if (allowed) {
            await expect(page.locator("main h1").first(), `${role} ${p.href}`).toBeVisible();
            await expect(page.getByText("You don’t have access to this page")).toHaveCount(0);
          } else {
            await expect(page.getByText("You don’t have access to this page"), `${role} ${p.href}`).toBeVisible();
            const resource = `/api${p.href === "/dashboard" ? "/control-tower" : p.href}`;
            const leaked = api.requests.slice(before).filter((r) => r.path.startsWith(resource));
            expect(leaked, `${role} ${p.href} must not request ${resource}`).toEqual([]);
          }
        }
      });
    });
  }
});
