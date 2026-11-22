import type { Page } from "@playwright/test";
import { TINY_PNG, tripDocuments } from "./fixtures/data";
import { calls, expect, test } from "./fixtures/test";

const PNG = Buffer.from(TINY_PNG.split(",")[1], "base64");

async function openTrip(page: Page) {
  await page.goto("/trips/1");
  const section = page.getByRole("region", { name: "Trip documents" });
  await expect(section).toBeVisible();
  return section;
}

/** Draws a short stroke inside the signature pad with the mouse (pointer events). */
async function sign(page: Page) {
  const pad = page.getByRole("img", { name: /Receiver's signature/ });
  // The pad sits below the fold of the dialog: bring it into view before drawing.
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await page.mouse.move(box.x + 140, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(pad).toHaveAccessibleName(/signed/);
}

test.describe("trip documents section", () => {
  test("shows compliance, per-delivery paperwork and the role-filtered pack download", async ({ page }) => {
    const section = await openTrip(page);
    await expect(section.getByRole("region", { name: "Compliance for this trip" })).toContainText("in order");
    const order = section.getByRole("region", { name: /ORD-QA0001/ });
    await expect(order).toContainText("Deliver to Vashi Market");
    await expect(order.getByRole("button", { name: "Record E-Way Bill" })).toBeVisible();
    await expect(order.getByRole("button", { name: "Issue LR" })).toBeVisible();
    await expect(order.getByRole("button", { name: "Record delivery" })).toBeVisible();
    await expect(order).toContainText("RaahSetu does not generate E-Way Bills");
    await expect(section.getByRole("link", { name: /Download document pack/ })).toHaveAttribute("href", "/api/trips/1/documents/pack");
  });

  test("records an E-Way Bill with validation and attaches it to the order and trip", async ({ page, api }) => {
    const section = await openTrip(page);
    await section.getByRole("button", { name: "Record E-Way Bill" }).click();
    const dialog = page.getByRole("dialog", { name: "E-Way Bill · ORD-QA0001" });
    await dialog.getByLabel(/E-Way Bill number/).fill("3910 1234 567"); // 11 digits
    await dialog.getByLabel("Supplier", { exact: true }).fill("Delhi Traders");
    await dialog.getByLabel("Place of dispatch").fill("Bhiwandi");
    await dialog.getByLabel("Goods description").fill("Steel almirahs");
    await dialog.getByRole("button", { name: "Save E-Way Bill" }).click();
    await expect(dialog.getByText("The E-Way Bill number has 12 digits.").first()).toBeVisible();
    expect(calls(api, "POST", "/api/eway-bills")).toHaveLength(0);

    await dialog.getByLabel(/E-Way Bill number/).fill("3910 1234 5678");
    await dialog.getByRole("group", { name: "E-Way Bill copy" }).locator('input[type="file"]:not([capture])').setInputFiles({ name: "ewb.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 ewb") });
    await dialog.getByRole("button", { name: "Save E-Way Bill" }).click();
    await expect(dialog).toBeHidden();
    const body = String(calls(api, "POST", "/api/eway-bills")[0].body);
    expect(body).toMatch(/name="orderId"\r\n\r\n1\r\n/);
    expect(body).toMatch(/name="tripId"\r\n\r\n1\r\n/);
    expect(body).toMatch(/name="ewbNumber"\r\n\r\n3910 1234 5678\r\n/);
    expect(body).toMatch(/name="file"; filename="ewb\.pdf"/);
  });

  test("issues a lorry receipt pre-filled from the order and trip", async ({ page, api }) => {
    const section = await openTrip(page);
    await section.getByRole("button", { name: "Issue LR" }).click();
    const dialog = page.getByRole("dialog", { name: "Lorry receipt · ORD-QA0001" });
    await dialog.getByLabel("Goods description").fill("Steel almirahs");
    await dialog.getByLabel("Packages").fill("12");
    await dialog.getByLabel("Freight (₹)").fill("6500");
    await dialog.getByLabel("Payment terms").selectOption("TO_PAY");
    await dialog.getByRole("button", { name: "Issue lorry receipt" }).click();
    await expect(dialog).toBeHidden();
    expect(calls(api, "POST", "/api/lorry-receipts")[0].body).toMatchObject({ orderId: 1, tripId: 1, goodsDescription: "Steel almirahs", packages: 12, freightAmount: 6500, paymentTerms: "TO_PAY" });
  });
});

test.describe("skipped delivery stop", () => {
  test.use({
    overrides: {
      "GET /api/trips/1/documents": () => ({ body: { ...tripDocuments, orders: tripDocuments.orders.map((o) => ({ ...o, stopStatus: "SKIPPED" })) } }),
    },
  });
  test("does not offer Record delivery (the order went back to planning)", async ({ page }) => {
    const section = await openTrip(page);
    const order = section.getByRole("region", { name: /ORD-QA0001/ });
    await expect(order.getByRole("button", { name: "Issue LR" })).toBeVisible();
    await expect(order.getByRole("button", { name: "Record delivery" })).toHaveCount(0);
  });
});

test.describe("proof of delivery", () => {
  test("requires a signature, then sends the POD with signature and photo for the right stop", async ({ page, api }) => {
    const section = await openTrip(page);
    await section.getByRole("button", { name: "Record delivery" }).click();
    const dialog = page.getByRole("dialog", { name: "Proof of delivery · ORD-QA0001" });
    await dialog.getByLabel("Received by").fill("Rakesh Gupta");
    await dialog.getByRole("button", { name: "Save proof of delivery" }).click();
    await expect(dialog.getByText("Ask the receiver to sign before saving.").first()).toBeVisible();
    expect(calls(api, "POST", "/api/pods")).toHaveLength(0);

    // Photos: camera input opens the rear camera; PDFs are not offered for POD photos.
    const photos = dialog.getByRole("group", { name: "Delivery photos" });
    await expect(photos.locator('input[type="file"][capture="environment"]')).toHaveAttribute("accept", "image/*");
    await expect(photos.locator('input[type="file"]:not([capture])')).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    await photos.locator('input[type="file"]:not([capture])').setInputFiles({ name: "goods.png", mimeType: "image/png", buffer: PNG });
    await expect(photos.getByRole("img", { name: /Preview of goods\.png/ })).toBeVisible();

    await sign(page);
    await dialog.getByRole("button", { name: "Save proof of delivery" }).click();
    await expect(dialog).toBeHidden();
    const body = String(calls(api, "POST", "/api/pods")[0].body);
    expect(body).toMatch(/name="tripId"\r\n\r\n1\r\n/);
    expect(body).toMatch(/name="tripStopId"\r\n\r\n3\r\n/);
    expect(body).toMatch(/name="status"\r\n\r\nDELIVERED\r\n/);
    expect(body).toMatch(/name="receiverName"\r\n\r\nRakesh Gupta\r\n/);
    expect(body).toMatch(/name="signature"; filename="signature\.png"/);
    expect(body).toMatch(/name="photos"; filename="goods\.jpg"/); // compressed to JPEG before upload
  });

  test("a failed delivery needs remarks and sends no signature", async ({ page, api }) => {
    const section = await openTrip(page);
    await section.getByRole("button", { name: "Record delivery" }).click();
    const dialog = page.getByRole("dialog", { name: "Proof of delivery · ORD-QA0001" });
    await dialog.getByLabel("Outcome").selectOption("FAILED");
    await expect(dialog.getByRole("img", { name: /Receiver's signature/ })).toHaveCount(0);
    await expect(dialog.getByText(/goes back to the planning pool/)).toBeVisible();
    await dialog.getByLabel("Person contacted").fill("Security guard");
    await dialog.getByRole("button", { name: "Save proof of delivery" }).click();
    await expect(dialog.getByText("Explain why the delivery did not happen.").first()).toBeVisible();
    await dialog.getByLabel("Remarks").fill("Premises closed");
    await dialog.getByRole("button", { name: "Save proof of delivery" }).click();
    await expect(dialog).toBeHidden();
    const body = String(calls(api, "POST", "/api/pods")[0].body);
    expect(body).toMatch(/name="status"\r\n\r\nFAILED\r\n/);
    expect(body).not.toMatch(/name="signature"/);
  });

  test.describe("retry after the first response was lost", () => {
    test.use({
      overrides: {
        "POST /api/pods": () => ({ status: 409, body: { error: { code: "POD_EXISTS", message: "A proof of delivery already exists for this stop; edit it instead", details: { podId: 5, status: "DELIVERED" } } } }),
      },
    });
    test("treats the existing POD as saved instead of showing an error", async ({ page }) => {
      const section = await openTrip(page);
      await section.getByRole("button", { name: "Record delivery" }).click();
      const dialog = page.getByRole("dialog", { name: "Proof of delivery · ORD-QA0001" });
      await dialog.getByLabel("Received by").fill("Rakesh Gupta");
      await sign(page);
      await dialog.getByRole("button", { name: "Save proof of delivery" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("This delivery was already recorded")).toBeVisible();
    });
  });

  test.describe("server rejects the POD", () => {
    test.use({ overrides: { "POST /api/pods": () => ({ status: 409, body: { error: { code: "CONFLICT", message: "Complete the pickup for this order before its delivery" } } }) } });
    test("keeps the form open with the reason", async ({ page }) => {
      const section = await openTrip(page);
      await section.getByRole("button", { name: "Record delivery" }).click();
      const dialog = page.getByRole("dialog", { name: "Proof of delivery · ORD-QA0001" });
      await dialog.getByLabel("Received by").fill("Rakesh Gupta");
      await sign(page);
      await dialog.getByRole("button", { name: "Save proof of delivery" }).click();
      await expect(dialog.getByText("Complete the pickup for this order before its delivery").first()).toBeVisible();
      await expect(dialog).toBeVisible();
    });
  });
});
