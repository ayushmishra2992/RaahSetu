import { calls, expect, test } from "./fixtures/test";

test.describe("orders", () => {
  test("status tabs and search narrow the list", async ({ page }) => {
    await page.goto("/orders");
    const table = page.getByRole("table", { name: "Orders" });
    await expect(table.getByRole("row")).toHaveCount(7); // header + 6
    await page.getByRole("tab", { name: /Pending/ }).click();
    await expect(table.getByRole("row")).toHaveCount(3);
    await page.getByRole("searchbox").fill("Dadar");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("ORD-QA0005");
  });

  test("client validation blocks an invalid order before any request", async ({ page, api }) => {
    await page.goto("/orders?new=1");
    const dialog = page.getByRole("dialog", { name: "New order" });
    await dialog.getByLabel("Customer", { exact: true }).fill("Kurla Traders");
    await dialog.getByLabel("Pickup").selectOption({ label: "Vashi Warehouse" });
    await dialog.getByLabel("Drop").selectOption({ label: "Vashi Warehouse" });
    await dialog.getByLabel("Weight (kg)").fill("750");
    await dialog.getByRole("button", { name: "Create order" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Fix 1 highlighted field");
    await expect(dialog.getByLabel("Drop")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText("Pickup and drop must be different locations.")).toBeVisible();
    expect(calls(api, "POST", "/api/orders")).toHaveLength(0);
  });

  test("a pending order can be opened and edited", async ({ page, api }) => {
    await page.goto("/orders?open=4");
    const drawer = page.getByRole("dialog", { name: "ORD-QA0004" });
    await expect(drawer).toContainText("Not on any trip yet.");
    await drawer.getByRole("button", { name: "Edit order" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit ORD-QA0004" });
    await dialog.getByLabel("Weight (kg)").fill("700");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    const [req] = calls(api, "PATCH", "/api/orders/4");
    expect(req.body).toMatchObject({ weightKg: 700, customerName: "Andheri Retail Pvt Ltd", pickupLocationId: 2, dropLocationId: 3 });
  });

  test("orders on a trip link to it and can't be edited", async ({ page }) => {
    await page.goto("/orders?open=1");
    const drawer = page.getByRole("dialog", { name: "ORD-QA0001" });
    await expect(drawer.getByRole("link", { name: "TRP-QA0001" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Edit order" })).toHaveCount(0);
  });
});

test.describe("trips", () => {
  test("lifecycle and stop timeline reflect the trip", async ({ page }) => {
    await page.goto("/trips/1");
    const progress = page.getByRole("navigation", { name: "Trip progress" });
    await expect(progress.locator('[aria-current="step"]')).toContainText("In transit");
    await expect(page.getByText("2 pickup/drop stop(s) still open")).toBeVisible();
    await page.getByRole("button", { name: "Trip QR" }).click();
    await expect(page.getByRole("dialog", { name: "Trip verification QR" }).getByRole("img")).toBeVisible();
  });

  test.describe("conflict", () => {
    test.use({ overrides: { "POST /api/trips/1/stops/4": () => ({ status: 409, body: { error: { message: "Trip is no longer in transit." } } }) } });
    test("a 409 explains the conflict and refreshes the trip", async ({ page, api }) => {
      await page.goto("/trips/1");
      await page.getByRole("button", { name: "Delivered" }).first().click();
      await expect(page.getByText("Trip is no longer in transit. The trip has been refreshed")).toBeVisible();
      await expect.poll(() => calls(api, "GET", "/api/trips/1").length).toBeGreaterThan(1);
    });
  });

  test("active tab hides finished trips", async ({ page }) => {
    await page.goto("/trips");
    const table = page.getByRole("table", { name: "Trips" });
    await expect(table.getByRole("row")).toHaveCount(4); // header + 3 active
    await page.getByRole("tab", { name: /Completed/ }).click();
    await expect(table.getByRole("row")).toHaveCount(2);
  });
});

test.describe("manual dispatch", () => {
  test("requires a vehicle, driver and orders", async ({ page, api }) => {
    await page.goto("/trips/new");
    await page.getByRole("button", { name: "Create trip" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't save" })).toContainText("Fix 3 highlighted items");
    expect(calls(api, "POST", "/api/trips")).toHaveLength(0);
  });

  test.describe("infeasible", () => {
    test.use({ overrides: { "POST /api/trips": () => ({ status: 422, body: { error: { message: "Trip is infeasible", details: ["ORD-QA0004: delivery window cannot be met"] } } }) } });
    test("shows the server's reasons", async ({ page, api }) => {
      await page.goto("/trips/new");
      await page.getByLabel("Vehicle").selectOption({ index: 1 });
      await page.getByLabel("Driver").selectOption({ index: 1 });
      await page.getByRole("checkbox").first().check();
      await expect(page.getByRole("meter")).toBeVisible();
      await page.getByRole("button", { name: "Create trip" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Couldn't save" })).toContainText("ORD-QA0004: delivery window cannot be met");
      expect((calls(api, "POST", "/api/trips")[0].body as { orderIds: number[] }).orderIds).toEqual([4]);
    });
  });
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("orders become cards with the same actions", async ({ page, api }) => {
    await page.goto("/orders");
    await expect(page.getByRole("table", { name: "Orders" })).toBeHidden();
    const list = page.getByRole("list", { name: "Orders" });
    await expect(list.getByRole("listitem")).toHaveCount(6);
    const card = list.getByRole("listitem").filter({ hasText: "ORD-QA0004" });
    await expect(card).toContainText("Andheri Retail Pvt Ltd");
    await expect(card).toContainText("Pending");
    // Orders that aren't pending offer no actions, as on desktop.
    await expect(list.getByRole("listitem").filter({ hasText: "ORD-QA0001" }).getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await card.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog", { name: "Cancel order?" }).getByRole("button", { name: "Cancel order" }).click();
    await expect.poll(() => calls(api, "POST", "/api/orders/4/cancel").length).toBe(1);
  });

  for (const [path, list, first] of [
    ["/trips", "Trips", "TRP-QA0001"],
    ["/vehicles", "Vehicles", "MH04QA1001"],
    ["/drivers", "Drivers", "QA Driver One"],
    ["/documents", "Compliance documents", "PUC"],
  ] as const) {
    test(`${path} uses cards on phones`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("list", { name: list })).toContainText(first);
      await expect(page.getByRole("table", { name: list })).toBeHidden();
    });
  }
});
