import { calls, expect, test } from "./fixtures/test";

test.describe("billing", () => {
  test("summary sums the listed invoices and labels what is not tracked", async ({ page }) => {
    await page.goto("/billing");
    const summary = page.getByRole("region", { name: "Invoice summary" });
    await expect(summary).toContainText("₹11,800.00");
    await expect(page.getByText("amounts received are not tracked")).toBeVisible();
    await page.getByRole("tab", { name: /Draft/ }).click();
    await expect(page.getByRole("table", { name: "Billing documents" }).getByRole("row")).toHaveCount(2);
  });

  test("the form previews backend-identical totals and blocks an invalid GSTIN", async ({ page, api }) => {
    await page.goto("/billing");
    await page.getByRole("button", { name: "New document" }).click();
    const dialog = page.getByRole("dialog", { name: "New invoice or challan" });
    await dialog.getByLabel("Customer", { exact: true }).fill("Kurla Traders");
    await dialog.getByLabel("Line 1 quantity").fill("1.5");
    await dialog.getByLabel("Line 1 rate").fill("1000.01");
    await expect(dialog.getByText("₹1,770.02")).toBeVisible(); // 1500.02 + 18% (270.00)
    await dialog.getByLabel("Customer GSTIN").fill("27ABC");
    await dialog.getByRole("button", { name: "Create draft" }).click();
    await expect(dialog.getByText("GSTIN must be 15 letters or digits.")).toBeVisible();
    expect(calls(api, "POST", "/api/billing")).toHaveLength(0);
    await dialog.getByLabel("Customer GSTIN").fill("27aabct1234b1z2");
    await dialog.getByRole("button", { name: "Create draft" }).click();
    await expect.poll(() => calls(api, "POST", "/api/billing").length).toBe(1);
    expect(calls(api, "POST", "/api/billing")[0].body).toMatchObject({ kind: "INVOICE", customerName: "Kurla Traders", customerGstin: "27AABCT1234B1Z2", taxRatePercent: 18, items: [{ quantity: 1.5, rate: 1000.01 }] });
  });

  test("cancelling an issued invoice is confirmed", async ({ page, api }) => {
    await page.goto("/billing/1");
    await page.getByRole("button", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel INV-2026-QA0001?" });
    await expect(dialog).toContainText("can't be undone");
    await dialog.getByRole("button", { name: "Cancel document" }).click();
    await expect.poll(() => calls(api, "POST", "/api/billing/1/cancel").length).toBe(1);
  });
});

test.describe("GreenFleet", () => {
  test("separates estimates from logged fuel and deep-links to the fuel log", async ({ page }) => {
    await page.goto("/greenfleet");
    await expect(page.getByRole("region", { name: "Totals for the period" })).toContainText("CO₂ from logged fuel");
    await page.goto("/greenfleet?tab=fuel");
    await expect(page.getByRole("tab", { name: /Fuel log/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: "Fuel log" })).toBeVisible();
  });

  test("the job estimator ranks only vehicles that can carry the load", async ({ page, api }) => {
    await page.goto("/greenfleet");
    await page.getByRole("tab", { name: "Compare vehicles for a job" }).click();
    await page.getByRole("button", { name: "Estimate" }).click();
    const table = page.getByRole("table", { name: /per vehicle/ });
    await expect(table.getByRole("row", { name: /MH04QA1001/ })).toContainText("Lowest CO₂");
    await expect(table.getByRole("row", { name: /MH04QA1002/ })).toContainText("No (800 kg max)");
    expect(calls(api, "POST", "/api/greenfleet/estimate")[0].body).toEqual({ distanceKm: 120, loadKg: 1000 });
  });
});

test.describe("scenarios", () => {
  test("before/after deltas are judged per metric", async ({ page }) => {
    await page.goto("/scenarios/1");
    await expect(page.getByText("MH04QA1003 is unavailable (breakdown).")).toBeVisible();
    const table = page.getByRole("table", { name: "Scenario impact" });
    await expect(table.getByRole("row", { name: /^Objective J/ })).toContainText("Worse");
    await expect(table.getByRole("row", { name: /^Served orders/ })).toContainText("No change");
  });

  test.describe("dispatcher", () => {
    test.use({ role: "DISPATCHER" });
    test("can evaluate but not decide", async ({ page }) => {
      await page.goto("/scenarios/1");
      await expect(page.getByText("A manager or admin decides")).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve & apply" })).toHaveCount(0);
    });
  });
});

test.describe("administration", () => {
  test("user creation checks the password rule before calling the API", async ({ page, api }) => {
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    const dialog = page.getByRole("dialog", { name: "Add user" });
    await dialog.getByLabel("Name").fill("New Person");
    await dialog.getByLabel("Email").fill("new@example.test");
    await dialog.getByLabel("Initial password").fill("password");
    await dialog.getByRole("button", { name: "Create user" }).click();
    await expect(dialog.getByText("Include at least one letter and one number.").first()).toBeVisible();
    expect(calls(api, "POST", "/api/users")).toHaveLength(0);
  });

  test("the audit log reads as sentences, not JSON", async ({ page }) => {
    await page.goto("/audit");
    const table = page.getByRole("table", { name: "Audit events" });
    await expect(table.getByRole("row", { name: /Order updated/ })).toContainText("weightKg, windowEnd");
    await expect(table).not.toContainText("{");
    await expect(table.getByRole("link", { name: "Order #4" })).toHaveAttribute("href", "/orders?open=4");
  });

  test("settings validate against the backend limits", async ({ page, api }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Costs & emissions" }).click();
    const days = page.getByLabel("Document alert window (days)");
    // Out of range: the browser's own constraint validation blocks submission.
    await days.fill("400");
    await page.getByRole("button", { name: "Save factors" }).click();
    expect(await days.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(true);
    // Allowed by the input but outside the backend schema: the client check explains it.
    await days.fill("30");
    await page.getByLabel("Driver cost (₹/hour)").fill("-5");
    await page.getByLabel("Driver cost (₹/hour)").evaluate((el) => el.removeAttribute("min"));
    await page.getByRole("button", { name: "Save factors" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't save" })).toContainText("can't be negative");
    expect(calls(api, "PATCH", "/api/company")).toHaveLength(0);
  });

  test("password change requires a matching confirmation", async ({ page, api }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Your account" }).click();
    await page.getByLabel("Current password").fill("Old-pass1");
    await page.getByLabel("New password", { exact: true }).fill("New-pass12");
    await page.getByLabel("Confirm new password").fill("New-pass13");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The new passwords don't match.").first()).toBeVisible();
    expect(calls(api, "POST", "/api/auth/change-password")).toHaveLength(0);
  });

  test.describe("employee", () => {
    test.use({ role: "EMPLOYEE" });
    test("sees only their own account settings", async ({ page }) => {
      await page.goto("/settings");
      await expect(page.getByRole("tab")).toHaveText(["Your account"]);
    });
  });
});

test.describe("public pages", () => {
  test.use({ role: null });
  test("production login shows no seeding or developer hints", async ({ page }) => {
    test.skip(process.env.E2E_PRODUCTION !== "1", "checks the production build only (set E2E_PRODUCTION=1)");
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/db:seed|Development build/);
  });
});
