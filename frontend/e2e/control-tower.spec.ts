import * as F from "./fixtures/data";
import { calls, expect, test } from "./fixtures/test";

test.describe("Control Tower", () => {
  test("shows API figures, filters alerts and lists permitted quick actions", async ({ page, api }) => {
    await page.goto("/dashboard");
    const kpis = page.getByRole("region", { name: "Key figures" });
    await expect(kpis).toContainText("92.3%");
    await expect(kpis).toContainText("Estimate, not measured");

    const alerts = page.locator("#alerts");
    await expect(alerts.getByRole("listitem")).toHaveCount(4);
    await alerts.getByRole("tab", { name: /Critical/ }).click();
    await expect(alerts.getByRole("listitem")).toHaveCount(1);
    await expect(alerts.getByRole("listitem")).toContainText("PUC for MH04QA1002 expired");

    const quick = page.getByRole("navigation", { name: "Quick actions" });
    for (const name of ["New order", "Plan routes", "Create trip", "Add document", "Log fuel"]) await expect(quick.getByRole("link", { name })).toBeVisible();

    await expect(page.getByText("Order updated")).toBeVisible();
    await expect(page.getByRole("img", { name: /Vehicles by status: Available 1, On trip 2, Maintenance 1/ })).toBeVisible();
    // Only documents in the alert window are requested.
    expect(calls(api, "GET", "/api/documents")[0].query).toContain("expiringWithinDays=30");
  });

  test("live trips can be filtered by status", async ({ page }) => {
    await page.goto("/dashboard");
    const live = page.getByRole("region", { name: "Live operations" });
    await expect(live.getByRole("link", { name: /TRP-QA000/ })).toHaveCount(2);
    await live.getByRole("tab", { name: /Dispatched/ }).click();
    await expect(live.getByRole("link", { name: /TRP-QA000/ })).toHaveCount(1);
    await expect(live.getByRole("link", { name: /TRP-QA0002/ })).toBeVisible();
  });

  test.describe("read-only employee", () => {
    test.use({ role: "EMPLOYEE" });
    test("gets no quick actions and no audit feed", async ({ page, api }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Control Tower" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Quick actions" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Recent activity" })).toHaveCount(0);
      expect(calls(api, "GET", "/api/audit")).toHaveLength(0);
    });
  });

  test.describe("quiet day", () => {
    test.use({ overrides: { "GET /api/control-tower": { ...F.controlTower, alerts: [], liveTrips: [], recentRuns: [] } } });
    test("shows empty states instead of blank panels", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText("No trips on the road")).toBeVisible();
      await expect(page.getByText("All clear")).toBeVisible();
      await expect(page.getByText("No optimisation runs yet")).toBeVisible();
    });
  });

  test.describe("API failure", () => {
    test.use({ overrides: { "GET /api/control-tower": () => ({ status: 500, body: { error: { message: "Database unavailable" } } }) } });
    test("shows the error with a retry", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("alert").filter({ hasText: "Database unavailable" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    });
  });
});
