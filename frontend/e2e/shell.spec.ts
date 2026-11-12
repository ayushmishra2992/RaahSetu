import { expect, test } from "./fixtures/test";

test.describe("application shell", () => {
  test("sidebar collapses to an icon rail and remembers the choice", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const toggle = page.getByRole("button", { name: "Collapse sidebar" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    const expand = page.getByRole("button", { name: "Expand sidebar" });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    // Labels stay available to assistive tech in the collapsed rail.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Orders" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  });

  test("skip link is the first stop for keyboard users", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("main h1")).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("account menu works with the keyboard", async ({ page }) => {
    await page.goto("/dashboard");
    const trigger = page.getByRole("button", { name: /Account menu for QA Admin/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Log out" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("dialogs and drawers return focus, and failed actions stay visible (catalogue)", async ({ page }) => {
    // The catalogue is a `.dev.tsx` page: it only exists under `next dev`.
    test.skip(!!process.env.E2E_BASE_URL, "component catalogue is dev-only");
    await page.goto("/design-system");
    const openDialog = page.getByRole("button", { name: "Open dialog" });
    await openDialog.click();
    const dialog = page.getByRole("dialog", { name: "Dialog title" });
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(openDialog).toBeFocused();

    const openDrawer = page.getByRole("button", { name: "Open drawer" });
    await openDrawer.click();
    await expect(page.getByRole("dialog", { name: "Drawer title" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(openDrawer).toBeFocused();

    await page.getByRole("button", { name: "Confirm with failing action" }).click();
    const confirm = page.getByRole("dialog", { name: "Fails on confirm" });
    await confirm.getByRole("button", { name: "Try" }).click();
    await expect(confirm.getByRole("alert")).toContainText("Server said no");

    await confirm.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Success toast" }).click();
    await expect(page.getByRole("region", { name: "Notifications" }).getByRole("status")).toContainText("Order created");
  });

  test.describe("phone width", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("navigation drawer opens, traps Escape and closes on navigation", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
      const open = page.getByRole("button", { name: "Open navigation" });
      // Regression: icon-only buttons once inherited text padding and squashed their icon.
      expect((await open.locator("svg").boundingBox())?.width).toBeGreaterThanOrEqual(16);
      await open.click();
      const drawer = page.getByRole("dialog", { name: "Navigation" });
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(open).toBeFocused();

      await open.click();
      await drawer.getByRole("link", { name: "Vehicles" }).click();
      await expect(page).toHaveURL(/\/vehicles$/);
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("heading", { level: 1, name: "Vehicles" })).toBeVisible();
    });

    for (const path of ["/dashboard", "/optiroute", "/optiroute/runs/1", "/optiroute/compare?a=1&b=2", "/orders", "/trips", "/trips/1", "/trips/new", "/vehicles", "/vehicles/1", "/drivers", "/documents", "/locations", "/billing", "/billing/1", "/greenfleet", "/scenarios", "/scenarios/1", "/users", "/audit", "/settings"]) {
      test(`${path} has no horizontal page overflow`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("main h1, main article h1").first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });

  test.describe("tablet width", () => {
    test.use({ viewport: { width: 768, height: 1024 } });
    test("uses the drawer instead of the sidebar and keeps company context in the header", async ({ page }) => {
      await page.goto("/orders");
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
      await expect(page.getByTitle("Company workspace")).toContainText("QA Test Logistics");
    });
  });
});
