import { calls, expect, test } from "./fixtures/test";

test.describe("critical workflows", () => {
  test("create an order sends the expected payload", async ({ page, api }) => {
    await page.goto("/orders");
    await page.getByRole("button", { name: "New order" }).click();
    const dialog = page.getByRole("dialog", { name: "New order" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Customer", { exact: true }).fill("Kurla Traders");
    await dialog.getByLabel("Pickup").selectOption({ label: "Vashi Warehouse" });
    await dialog.getByLabel("Drop").selectOption({ label: "Andheri Customer" });
    await dialog.getByLabel("Weight (kg)").fill("750");
    await dialog.getByLabel("Priority").selectOption("HIGH");
    await dialog.getByRole("button", { name: "Create order" }).click();
    await expect(dialog).toBeHidden();
    const [req] = calls(api, "POST", "/api/orders");
    expect(req.body).toMatchObject({ customerName: "Kurla Traders", pickupLocationId: 2, dropLocationId: 3, weightKg: 750, priority: "HIGH", serviceMinutes: 20 });
  });

  test("aborting a trip needs confirmation; Escape cancels without a request", async ({ page, api }) => {
    await page.goto("/trips/1");
    const abort = page.getByRole("button", { name: "Abort trip" });
    await abort.click();
    const dialog = page.getByRole("dialog", { name: "Abort trip TRP-QA0001?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("orders return to pending");
    // Destructive dialogs focus the safe choice first.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(abort).toBeFocused();
    expect(calls(api, "POST", "/api/trips/1/status")).toHaveLength(0);

    await abort.click();
    await page.getByRole("dialog").getByRole("button", { name: "Abort trip" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Trip moved to Cancelled" })).toBeVisible();
    expect(calls(api, "POST", "/api/trips/1/status").map((r) => r.body)).toEqual([{ status: "CANCELLED", note: null }]);
  });

  test("dispatch-sensitive invoice actions are confirmed before the API call", async ({ page, api }) => {
    await page.goto("/billing/1");
    await page.getByRole("button", { name: "Mark paid" }).click();
    const dialog = page.getByRole("dialog", { name: "Mark INV-2026-QA0001 as paid?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(calls(api, "POST", "/api/billing/1/mark-paid")).toHaveLength(0);
    await page.getByRole("button", { name: "Mark paid" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(calls(api, "POST", "/api/billing/1/mark-paid")).toHaveLength(1);
  });

  test("legacy ConfirmButton actions now confirm in a dialog", async ({ page, api }) => {
    await page.goto("/orders");
    await page.getByRole("button", { name: "Cancel" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Cancel order?" });
    await dialog.getByRole("button", { name: "Cancel order" }).click();
    await expect(dialog).toBeHidden();
    expect(calls(api, "POST", "/api/orders/4/cancel")).toHaveLength(1);
  });

  test.describe("failed confirmed action", () => {
    test.use({ overrides: { "DELETE /api/documents/2": () => ({ status: 409, body: { error: { message: "Document is linked to an active trip" } } }) } });

    test("keeps the dialog open and shows the server error", async ({ page, api }) => {
      await page.goto("/documents");
      await page.getByRole("row", { name: /PUC-88123/ }).getByRole("button", { name: "Delete" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete?" });
      await dialog.getByRole("button", { name: "Delete" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Document is linked to an active trip");
      await expect(dialog).toBeVisible();
      expect(calls(api, "DELETE", "/api/documents/2")).toHaveLength(1);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    });
  });

  test.describe("form error", () => {
    test.use({ overrides: { "POST /api/users": () => ({ status: 409, body: { error: { message: "A user with this email already exists" } } }) } });

    test("moves focus to the error summary", async ({ page }) => {
      await page.goto("/users");
      await page.getByRole("button", { name: "Add user" }).click();
      const dialog = page.getByRole("dialog", { name: "Add user" });
      await dialog.getByLabel("Name").fill("New Person");
      await dialog.getByLabel("Email").fill("qa-admin@example.test");
      await dialog.getByLabel("Initial password").fill("Strong-pass1");
      await dialog.getByRole("button", { name: "Create user" }).click();
      const alert = dialog.getByRole("alert");
      await expect(alert).toContainText("A user with this email already exists");
      await expect(alert.locator("xpath=..")).toBeFocused();
    });
  });

  test("role changes are confirmed and can be abandoned", async ({ page, api }) => {
    await page.goto("/users");
    const row = page.getByRole("row", { name: /QA Viewer/ });
    await row.getByRole("combobox").selectOption("MANAGER");
    const dialog = page.getByRole("dialog", { name: /Change QA Viewer.s role to Manager\?/ });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row.getByRole("combobox")).toHaveValue("EMPLOYEE");
    expect(calls(api, "PATCH", "/api/users/4")).toHaveLength(0);
  });
});
