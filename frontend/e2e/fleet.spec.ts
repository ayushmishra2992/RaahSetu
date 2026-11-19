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
    const docs = page.getByRole("region", { name: "Documents", exact: true });
    await expect(docs).toContainText("Insurance");
    await expect(docs).toContainText("All documents in date");
    // The engine's verdict is shown above the list (fixture: PUC expired → blocked).
    await expect(page.getByRole("region", { name: "Compliance status" })).toContainText("PUC expired on 2026-10-01");
  });

  test("Add opens the upload dialog for this vehicle, with camera capture and validation", async ({ page, api }) => {
    await page.goto("/vehicles/1");
    const docs = page.getByRole("region", { name: "Documents", exact: true });
    await docs.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add document · MH04QA1001" });
    await expect(dialog).toBeVisible();
    expect(page.url()).toMatch(/\/vehicles\/1$/); // stays on the vehicle page

    // Only vehicle document types are offered.
    const type = dialog.getByLabel("Document", { exact: true });
    await expect(type.locator("option")).toContainText(["RC", "Insurance", "PUC", "Fitness", "Permit (national)", "State permit", "FASTag", "Other"]);
    await expect(type.locator("option", { hasText: "Driving licence" })).toHaveCount(0);

    // Two-sided cards get front and back capture; phone camera opens the rear camera.
    await type.selectOption("RC");
    await expect(dialog.getByRole("group", { name: "Front side" })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Back side" })).toBeVisible();
    await expect(dialog.locator('input[type="file"][capture="environment"]').first()).toHaveAttribute("accept", "image/*");
    await expect(dialog.getByRole("button", { name: "Take photo" }).first()).toBeVisible();

    // Insurance: one or more pages; an expiry date is required before anything is uploaded.
    await type.selectOption("INSURANCE");
    const pages = dialog.getByRole("group", { name: "Pages" });
    await expect(pages).toBeVisible();
    await dialog.getByLabel("Document number").fill("INS-2027-001");
    await dialog.getByRole("button", { name: "Save document" }).click();
    await expect(dialog.getByText(/normally has an expiry date/)).toBeVisible();
    expect(calls(api, "POST", "/api/documents")).toHaveLength(0);

    // Attach a PDF through the gallery/file picker and save.
    await pages.locator('input[type="file"]:not([capture])').setInputFiles({ name: "insurance.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%fixture\n") });
    await expect(pages).toContainText("insurance.pdf");
    await dialog.getByLabel("Expires on").fill("2027-08-31");
    await dialog.getByRole("button", { name: /Save document|Retry upload/ }).click();
    await expect(dialog).toBeHidden();

    const [post] = calls(api, "POST", "/api/documents");
    const body = String(post.body);
    expect(body).toMatch(/name="vehicleId"\r\n\r\n1\r\n/);
    expect(body).toMatch(/name="type"\r\n\r\nINSURANCE\r\n/);
    expect(body).toMatch(/name="documentNumber"\r\n\r\nINS-2027-001\r\n/);
    expect(body).toMatch(/name="pages"; filename="insurance\.pdf"/);
    expect(body).not.toMatch(/name="driverId"/);
  });

  test("the upload dialog rejects unsupported files before uploading", async ({ page, api }) => {
    await page.goto("/vehicles/1");
    await page.getByRole("region", { name: "Documents", exact: true }).getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add document · MH04QA1001" });
    await dialog.getByLabel("Document", { exact: true }).selectOption("PUC");
    const pages = dialog.getByRole("group", { name: "Pages" });
    await pages.locator('input[type="file"]:not([capture])').setInputFiles({ name: "IMG_0042.HEIC", mimeType: "image/heic", buffer: Buffer.from("not really heic") });
    await expect(pages.getByRole("alert")).toContainText("HEIC photos are not supported");
    await expect(pages.locator("li")).toHaveCount(0);
    expect(calls(api, "POST", "/api/documents")).toHaveLength(0);
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

  test("the Documents page uses the new upload: driver licence with front and back photos", async ({ page, api }) => {
    await page.goto("/documents?new=1");
    const dialog = page.getByRole("dialog", { name: "Add compliance document" });
    await dialog.getByLabel("Belongs to").selectOption("driver");
    await dialog.getByLabel("Driver", { exact: true }).selectOption({ index: 1 });
    await expect(dialog.getByLabel("Document", { exact: true })).toHaveValue("DRIVING_LICENSE");
    await expect(dialog.getByLabel("Document", { exact: true }).locator("option", { hasText: "Insurance" })).toHaveCount(0);
    await dialog.getByLabel("Document number").fill("MH0120200000001");
    await dialog.getByLabel("Expires on").fill("2030-01-31");
    const front = dialog.getByRole("group", { name: "Front side" });
    const back = dialog.getByRole("group", { name: "Back side" });
    await expect(front.getByRole("button", { name: "Take photo" })).toBeVisible();
    await front.locator('input[type="file"]:not([capture])').setInputFiles({ name: "front.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 front") });
    await back.locator('input[type="file"]:not([capture])').setInputFiles({ name: "back.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 back") });
    await expect(front).toContainText("front.pdf");
    await expect(back).toContainText("back.pdf");
    await dialog.getByRole("button", { name: "Save document" }).click();
    await expect(dialog).toBeHidden();
    const body = String(calls(api, "POST", "/api/documents")[0].body);
    expect(body).toMatch(/name="driverId"\r\n\r\n1\r\n/);
    expect(body).toMatch(/name="type"\r\n\r\nDRIVING_LICENSE\r\n/);
    expect(body).toMatch(/name="front"; filename="front\.pdf"/);
    expect(body).toMatch(/name="back"; filename="back\.pdf"/);
    expect(body).not.toMatch(/name="vehicleId"/);
  });

  test("Documents page keeps the vehicle preset from the link and shows upload errors with retry", async ({ page, api }) => {
    let attempts = 0;
    await page.route("**/api/documents", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      attempts++;
      return attempts === 1
        ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Server error — please try again." } }) })
        : route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 9 }) });
    });
    await page.goto("/documents?new=1&vehicleId=2");
    const dialog = page.getByRole("dialog", { name: "Add compliance document" });
    await expect(dialog.getByLabel("Vehicle", { exact: true })).toHaveValue("2");
    await dialog.getByLabel("Document", { exact: true }).selectOption("PUC");
    await dialog.getByLabel("Document number").fill("PUC-77");
    await dialog.getByLabel("Expires on").fill("2027-02-28");
    await dialog.getByRole("button", { name: "Save document" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Server error — please try again.");
    await expect(dialog.getByLabel("Document number")).toHaveValue("PUC-77"); // nothing lost
    await dialog.getByRole("button", { name: "Retry upload" }).click();
    await expect(dialog).toBeHidden();
    expect(attempts).toBe(2);
    expect(api.unmocked).toEqual([]);
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
