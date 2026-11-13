import { calls, expect, test } from "./fixtures/test";

test.describe("vehicles and drivers", () => {
  test("vehicle list filters by status and search", async ({ page }) => {
    await page.goto("/vehicles");
    const table = page.getByRole("table", { name: "Vehicles" });
    await expect(table.getByRole("row")).toHaveCount(5);
    await page.getByRole("tab", { name: /On trip/ }).click();
    await expect(table.getByRole("row")).toHaveCount(3);
    await page.getByRole("searchbox").fill("1003");
    await expect(table.getByRole("row")).toHaveCount(2);
  });

  test("vehicle detail shows compliance state from the company alert window", async ({ page }) => {
    await page.goto("/vehicles/1");
    const docs = page.getByRole("region", { name: "Compliance documents" });
    await expect(docs).toContainText("Insurance");
    await expect(docs).toContainText("All documents in date");
    await expect(docs.getByRole("link", { name: "Add" })).toHaveAttribute("href", "/documents?new=1&vehicleId=1");
  });

  test("admins link a driver to a DRIVER user from a list", async ({ page, api }) => {
    await page.goto("/drivers/1");
    await page.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit QA Driver One" });
    const login = dialog.getByLabel("App login");
    await expect(login).toHaveValue("5");
    await login.selectOption("");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    expect((calls(api, "PATCH", "/api/drivers/1")[0].body as { userId: number | null }).userId).toBeNull();
  });

  test.describe("manager", () => {
    test.use({ role: "MANAGER" });
    test("cannot list users, so keeps the id field and never calls /users", async ({ page, api }) => {
      await page.goto("/drivers/2");
      await page.getByRole("button", { name: "Edit" }).click();
      await expect(page.getByRole("dialog").getByLabel("Linked app user id (optional)")).toBeVisible();
      expect(calls(api, "GET", "/api/users")).toHaveLength(0);
    });
  });

  test("driver list counts licences due soon", async ({ page }) => {
    await page.goto("/drivers");
    await expect(page.getByText("Licence due within 30 days").locator("xpath=following-sibling::p[1]")).toHaveText("1");
  });
});

test.describe("compliance documents", () => {
  test("state tabs, honest disclaimer and owner filter", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByText("not checked against VAHAN")).toBeVisible();
    const table = page.getByRole("table", { name: "Compliance documents" });
    await page.getByRole("tab", { name: /Expiring soon/ }).click();
    await expect(table.getByRole("row")).toHaveCount(3);
    await page.goto("/documents?vehicleId=2");
    await expect(page.getByText("Showing documents for")).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("PUC");
  });

  test("renewal edits send the new dates", async ({ page, api }) => {
    await page.goto("/documents");
    await page.getByRole("button", { name: "Edit PUC PUC-88123" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit PUC PUC-88123" });
    await dialog.getByLabel("Document number").fill("PUC-99001");
    await dialog.getByLabel("Expires on").fill("2027-05-31");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    const body = calls(api, "PATCH", "/api/documents/2")[0].body as { documentNumber: string; expiresOn: string };
    expect(body.documentNumber).toBe("PUC-99001");
    expect(new Date(body.expiresOn).getFullYear()).toBe(2027);
  });

  test("an expiry before the issue date is rejected before upload", async ({ page, api }) => {
    await page.goto("/documents?new=1");
    const dialog = page.getByRole("dialog", { name: "Add compliance document" });
    await dialog.getByLabel("Vehicle").selectOption({ index: 1 });
    await dialog.getByLabel("Document number").fill("INS-1");
    await dialog.getByLabel("Issued on").fill("2026-06-01");
    await dialog.getByLabel("Expires on").fill("2026-05-01");
    await dialog.getByRole("button", { name: "Save document" }).click();
    await expect(dialog.getByText("Expiry date can’t be before the issue date.").first()).toBeVisible();
    expect(calls(api, "POST", "/api/documents")).toHaveLength(0);
  });
});

test.describe("locations and roads", () => {
  test("closing a road is confirmed and sent", async ({ page, api }) => {
    await page.goto("/locations");
    await page.getByRole("tab", { name: /Road segments/ }).click();
    await page.getByRole("row", { name: /Bhiwandi Jn ↔ Thane Jn/ }).getByRole("button", { name: "Close" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close road" }).click();
    await expect.poll(() => calls(api, "PATCH", "/api/road-network/edges/1").map((r) => r.body)).toEqual([{ isClosed: true }]);
  });

  test.describe("location in use", () => {
    test.use({ overrides: { "DELETE /api/locations/3": () => ({ status: 409, body: { error: { message: "Location is used by orders or trips" } } }) } });
    test("delete conflict is explained", async ({ page }) => {
      await page.goto("/locations");
      await page.getByRole("row", { name: /Andheri Customer/ }).getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete location" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Couldn't complete that" })).toContainText("Location is used by orders or trips");
    });
  });

  test("shortest path shows distance and route", async ({ page }) => {
    await page.goto("/locations");
    await page.getByRole("tab", { name: "Shortest path" }).click();
    await page.getByLabel("From", { exact: true }).selectOption({ label: "Bhiwandi Jn" });
    await page.getByLabel("To", { exact: true }).selectOption({ label: "Vashi Jn" });
    await page.getByRole("button", { name: "Find path" }).click();
    await expect(page.getByText("Bhiwandi Jn → Thane Jn → Airoli Jn → Vashi Jn")).toBeVisible();
  });
});
