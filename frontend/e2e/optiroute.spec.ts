import * as F from "./fixtures/data";
import { calls, expect, test } from "./fixtures/test";

test.describe("OptiRoute planner", () => {
  test("sends only the selected orders and vehicles, then opens the run", async ({ page, api }) => {
    await page.goto("/optiroute");
    await expect(page.getByRole("checkbox", { name: "Include ORD-QA0004" })).toBeChecked();
    await page.getByRole("checkbox", { name: "Include ORD-QA0005" }).uncheck();
    await expect(page.getByRole("complementary", { name: "Plan summary" })).toContainText("650 kg");
    await page.getByRole("radio", { name: /Simulated annealing/ }).check();
    await page.getByRole("button", { name: "Optimise routes" }).click();
    await expect(page).toHaveURL(/\/optiroute\/runs\/1$/);
    const body = calls(api, "POST", "/api/optiroute/runs")[0].body as Record<string, unknown>;
    expect(body.orderIds).toEqual([4]);
    expect(body.vehicleIds).toEqual([4]);
    expect(body.algorithm).toBe("SIMULATED_ANNEALING");
    expect(body.hardTimeWindows).toBe(true);
  });

  test("blocks running with nothing selected", async ({ page }) => {
    await page.goto("/optiroute");
    await page.getByRole("button", { name: "Clear shown" }).click();
    await expect(page.getByText("Select at least one order.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Optimise routes" })).toBeDisabled();
  });

  test.describe("solver error", () => {
    test.use({ overrides: { "POST /api/optiroute/runs": () => ({ status: 422, body: { error: { message: "No eligible vehicle", details: [{ label: "MH04QA1004", reason: "Insurance expired" }] } } }) } });
    test("shows the reason and retries", async ({ page, api }) => {
      await page.goto("/optiroute");
      await page.getByRole("button", { name: "Optimise routes" }).click();
      const alert = page.getByRole("alert").filter({ hasText: "Optimisation failed" });
      await expect(alert).toContainText("MH04QA1004: Insurance expired");
      await alert.getByRole("button", { name: "Retry" }).click();
      await expect.poll(() => calls(api, "POST", "/api/optiroute/runs").length).toBe(2);
    });
  });

  test.describe("read-only employee", () => {
    test.use({ role: "EMPLOYEE" });
    test("sees run history but cannot plan", async ({ page }) => {
      await page.goto("/optiroute");
      await expect(page.getByRole("tab", { name: "New plan" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "#1 Morning wave" })).toBeVisible();
    });
  });
});

test.describe("OptiRoute results", () => {
  test("run detail explains exclusions and never claims optimality", async ({ page }) => {
    await page.goto("/optiroute/runs/1");
    await expect(page.getByText(/This is a heuristic/)).toBeVisible();
    await page.getByRole("tab", { name: /Unserved & exclusions/ }).click();
    await expect(page.getByText("PUC expired")).toBeVisible();
    await page.getByRole("tab", { name: /Routes/ }).click();
    await expect(page.getByRole("table", { name: /Stops for MH04QA1001/ })).toBeVisible();
  });

  test.describe("comparison", () => {
    const better = { ...F.runResult, totals: { ...F.runResult.totals, servedOrders: 4, distanceKm: 150 } };
    test.use({ overrides: { "GET /api/optiroute/runs/2": { ...F.run, id: 2, result: better } } });
    test("judges each metric in the right direction", async ({ page }) => {
      await page.goto("/optiroute/compare?a=1&b=2");
      const row = (name: string) => page.getByRole("row", { name: new RegExp(`^${name}`) });
      await expect(row("Served orders")).toContainText("Better");
      await expect(row("Distance")).toContainText("Worse");
      await expect(row("Vehicles used")).toContainText("No change");
    });
  });

  test("history compares two selected runs", async ({ page }) => {
    await page.goto("/optiroute");
    await page.getByRole("tab", { name: /Run history/ }).click();
    await page.getByRole("checkbox", { name: "Select run #1 for comparison" }).check();
    await page.getByRole("checkbox", { name: "Select run #2 for comparison" }).check();
    await page.getByRole("link", { name: "Compare selected" }).click();
    await expect(page).toHaveURL(/compare\?a=1&b=2/);
  });
});
