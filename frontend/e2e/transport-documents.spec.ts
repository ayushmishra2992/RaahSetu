import { ewayBills, meFor, TINY_PNG, tripDocuments } from "./fixtures/data";
import { calls, expect, test } from "./fixtures/test";

test.describe("transport documents register", () => {
  test("lists E-Way Bills, lorry receipts and PODs with status filters and links to each record", async ({ page }) => {
    await page.goto("/transport-documents");
    await expect(page.getByRole("heading", { name: "Transport documents" })).toBeVisible();
    const table = page.getByRole("table", { name: "E-Way Bills" });
    await expect(table.getByRole("link", { name: "3910 1234 5678" })).toHaveAttribute("href", "/transport-documents/eway-bills/11");
    await expect(table).toContainText("Valid");
    await expect(table).toContainText("Cancelled");

    await page.getByLabel("Filter by status").selectOption("CANCELLED");
    await expect(table.getByRole("link", { name: "3910 9999 0000" })).toBeVisible();
    await expect(table.getByRole("link", { name: "3910 1234 5678" })).toHaveCount(0);

    await page.getByRole("tab", { name: /Lorry receipts/ }).click();
    const lrs = page.getByRole("table", { name: "Lorry receipts" });
    await expect(lrs.getByRole("link", { name: "LR-20261118-QA0001" })).toHaveAttribute("href", "/transport-documents/lorry-receipts/21");
    await expect(lrs).toContainText("Draft");
    await expect(lrs).toContainText("Final");

    await page.getByRole("tab", { name: /Proofs of delivery/ }).click();
    await expect(page.getByRole("table", { name: "Proofs of delivery" })).toContainText("QA Receiver");
    await expect(page.getByRole("link", { name: /POD PDF for ORD-QA0003/ })).toHaveAttribute("href", "/api/pods/31/pdf");
    await expect(page.getByRole("link", { name: /Invoices & delivery challans/ })).toHaveAttribute("href", "/billing");
    await expect(page.getByRole("link", { name: /Vehicle & driver compliance/ })).toHaveAttribute("href", "/documents");
  });
});

test.describe("transport documents register (driver)", () => {
  test.use({ role: "DRIVER" });
  test("drivers see their documents but no links to billing or compliance registers they cannot open", async ({ page }) => {
    await page.goto("/transport-documents");
    await expect(page.getByRole("table", { name: "E-Way Bills" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Other document registers" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Invoices & delivery challans/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Vehicle & driver compliance/ })).toHaveCount(0);
  });
});

test.describe("transport documents register (billing without compliance access)", () => {
  // No built-in role has this combination; it checks each link follows its own permission.
  test.use({
    overrides: {
      "GET /api/auth/me": (() => {
        const me = meFor("EMPLOYEE");
        return { ...me, permissions: me.permissions.filter((x: string) => x !== "documents:read") };
      })(),
    },
  });
  test("shows only the links the user's permissions allow", async ({ page }) => {
    await page.goto("/transport-documents");
    await expect(page.getByRole("link", { name: /Invoices & delivery challans/ })).toHaveAttribute("href", "/billing");
    await expect(page.getByRole("link", { name: /Vehicle & driver compliance/ })).toHaveCount(0);
  });
});

test.describe("E-Way Bill record", () => {
  test("shows every recorded detail, opens files and edits the record", async ({ page, api }) => {
    await page.goto("/transport-documents/eway-bills/11");
    await expect(page.getByRole("heading", { name: "E-Way Bill 3910 1234 5678" })).toBeVisible();
    for (const text of ["QA Supplier Pvt Ltd", "27AAACQ1234A1Z5", "Synthetic test cartons", "9403", "20 BOX", "INV-QA-1", "MH04QA1001", "ewb-portal-copy.pdf"]) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "History" })).toContainText("Files added");
    await expect(page.getByText(/does not generate, extend, cancel or validate/)).toBeVisible();

    await page.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog", { name: /Edit E-Way Bill/ });
    await expect(dialog.getByLabel("Goods description")).toHaveValue("Synthetic test cartons");
    await dialog.getByLabel("Goods description").fill("Synthetic cartons (edited)");
    await dialog.getByLabel("Valid until").fill("2026-11-15"); // before the document date
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByText("Valid-until cannot be before the document date.").first()).toBeVisible();
    expect(calls(api, "PATCH", "/api/eway-bills/11")).toHaveLength(0);
    await dialog.getByLabel("Valid until").fill("");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    const body = calls(api, "PATCH", "/api/eway-bills/11")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ goodsDescription: "Synthetic cartons (edited)", validUntil: null, ewbNumber: "391012345678", hsnCode: "9403" });
  });

  test("adds files after recording", async ({ page, api }) => {
    await page.goto("/transport-documents/eway-bills/11");
    await page.getByRole("button", { name: "Add files" }).click();
    const dialog = page.getByRole("dialog", { name: /Add files/ });
    await expect(dialog).toContainText("1 of 5 files attached");
    await dialog.getByRole("group", { name: "Additional files" }).locator('input[type="file"]:not([capture])').setInputFiles({ name: "page-2.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") });
    await dialog.getByRole("button", { name: "Upload files" }).click();
    await expect(dialog).toBeHidden();
    expect(String(calls(api, "POST", "/api/eway-bills/11/files")[0].body)).toMatch(/name="file"; filename="page-2\.pdf"/);
  });

  test("cancels only with a reason, and says the portal is separate", async ({ page, api }) => {
    await page.goto("/transport-documents/eway-bills/11");
    await page.getByRole("button", { name: "Cancel record" }).click();
    const dialog = page.getByRole("dialog", { name: /Cancel E-Way Bill record/ });
    await expect(dialog).toContainText("does not cancel the E-Way Bill on the government portal");
    await dialog.getByLabel("Reason for cancelling").fill("ab");
    await dialog.getByRole("button", { name: "Cancel document" }).click();
    await expect(dialog.getByText("Give a reason of at least 3 characters.").first()).toBeVisible();
    expect(calls(api, "POST", "/api/eway-bills/11/cancel")).toHaveLength(0);
    await dialog.getByLabel("Reason for cancelling").fill("Synthetic: vehicle changed");
    await dialog.getByRole("button", { name: "Cancel document" }).click();
    await expect(dialog).toBeHidden();
    expect(calls(api, "POST", "/api/eway-bills/11/cancel")[0].body).toEqual({ reason: "Synthetic: vehicle changed" });
  });

  test("a cancelled record shows its reason and offers no changes", async ({ page }) => {
    await page.goto("/transport-documents/eway-bills/12");
    await expect(page.getByText("This E-Way Bill record is cancelled")).toBeVisible();
    await expect(page.getByText(/Reason: Synthetic: wrong vehicle/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add files" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel record" })).toHaveCount(0);
  });
});

test.describe("E-Way Bill record (read-only role)", () => {
  test.use({ role: "EMPLOYEE" });
  test("employees can read but not change it", async ({ page }) => {
    await page.goto("/transport-documents/eway-bills/11");
    await expect(page.getByRole("heading", { name: "E-Way Bill 3910 1234 5678" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel record" })).toHaveCount(0);
  });
});

test.describe("lorry receipt", () => {
  test("shows freight, advance and balance, PDF links, and edits a draft", async ({ page, api }) => {
    await page.goto("/transport-documents/lorry-receipts/21");
    await expect(page.getByRole("heading", { name: "Lorry receipt LR-20261118-QA0001" })).toBeVisible();
    const freight = page.getByRole("region", { name: "Freight" });
    await expect(freight).toContainText("6,500");
    await expect(freight).toContainText("2,000");
    await expect(freight).toContainText("4,500");
    await expect(page.getByRole("link", { name: /View \/ print PDF/ })).toHaveAttribute("href", "/api/lorry-receipts/21/pdf?inline=1");
    await expect(page.getByRole("link", { name: /Download PDF/ })).toHaveAttribute("href", "/api/lorry-receipts/21/pdf");
    await expect(page.getByRole("region", { name: "Trip" })).toContainText("MH04QA1001");

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Edit lorry receipt/ });
    await dialog.getByLabel("Advance received (₹)").fill("7000");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByText("The advance cannot be more than the freight.").first()).toBeVisible();
    await dialog.getByLabel("Advance received (₹)").fill("3000");
    await expect(dialog).toContainText("Balance: ₹3,500");
    await dialog.getByLabel("Consignee", { exact: true }).fill("QA Customer Branch");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    expect(calls(api, "PATCH", "/api/lorry-receipts/21")[0].body).toMatchObject({ advanceAmount: 3000, freightAmount: 6500, consigneeName: "QA Customer Branch", paymentTerms: "TO_PAY" });
  });

  test("finalizes after confirmation", async ({ page, api }) => {
    await page.goto("/transport-documents/lorry-receipts/21");
    await page.getByRole("button", { name: "Finalize", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: /Finalize LR-20261118-QA0001/ });
    await expect(confirm).toContainText("can no longer be edited");
    await confirm.getByRole("button", { name: "Finalize LR" }).click();
    await expect(confirm).toBeHidden();
    expect(calls(api, "POST", "/api/lorry-receipts/21/finalize")).toHaveLength(1);
  });

  test("a finalized LR shows its terms, cannot be edited, and can be cancelled with a reason", async ({ page, api }) => {
    await page.goto("/transport-documents/lorry-receipts/22");
    await expect(page.getByText("Synthetic company terms line.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Finalize", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel LR" }).click();
    const dialog = page.getByRole("dialog", { name: /Cancel lorry receipt/ });
    await dialog.getByLabel("Reason for cancelling").fill("Synthetic: duplicate LR");
    await dialog.getByRole("button", { name: "Cancel document" }).click();
    await expect(dialog).toBeHidden();
    expect(calls(api, "POST", "/api/lorry-receipts/22/cancel")[0].body).toEqual({ reason: "Synthetic: duplicate LR" });
  });
});

test.describe("trip paperwork links", () => {
  test.use({
    overrides: {
      "GET /api/trips/1/documents": {
        ...tripDocuments,
        orders: [{ ...tripDocuments.orders[0], ewayBills: [ewayBills[0]], lorryReceipts: [{ id: 21, lrNumber: "LR-20261118-QA0001", status: "ACTIVE", orderId: 1, finalizedAt: null }] }],
      },
    },
  });

  test("each E-Way Bill and LR on a trip opens its full record", async ({ page }) => {
    await page.goto("/trips/1");
    const order = page.getByRole("region", { name: /ORD-QA0001/ });
    await expect(order.getByRole("link", { name: /E-Way Bill 391012345678: details/ })).toHaveAttribute("href", "/transport-documents/eway-bills/11");
    await expect(order.getByRole("link", { name: /Lorry receipt LR-20261118-QA0001: details/ })).toHaveAttribute("href", "/transport-documents/lorry-receipts/21");
    await expect(order).toContainText("Draft");
  });
});

// ───── Proof of delivery: dispute resolution and photos added later ─────
const disputedPod = {
  id: 41, tripId: 1, tripStopId: 3, orderId: 1, status: "DISPUTED", receiverName: "QA Receiver", receiverPhone: null, deliveredAt: new Date(Date.now() - 3600_000).toISOString(),
  deliveredQuantity: 480, shortageDetails: null, damageDetails: null, remarks: "Synthetic: customer disputes quantity",
  attachments: [
    { id: 701, role: "SIGNATURE", fileName: "signature.png", fileMimeType: "image/png", fileSizeBytes: 900, createdAt: new Date().toISOString() },
    { id: 702, role: "PHOTO", fileName: "photo-1.jpg", fileMimeType: "image/jpeg", fileSizeBytes: 9000, createdAt: new Date().toISOString() },
  ],
};
const withDisputedPod = { ...tripDocuments, orders: [{ ...tripDocuments.orders[0], stopStatus: "COMPLETED", pod: disputedPod }] };

test.describe("disputed proof of delivery (manager or admin)", () => {
  test.use({ overrides: { "GET /api/trips/1/documents": withDisputedPod } });

  test("resolves a dispute with an agreed outcome and remarks", async ({ page, api }) => {
    await page.goto("/trips/1");
    const order = page.getByRole("region", { name: /ORD-QA0001/ });
    await expect(order).toContainText("Remarks: Synthetic: customer disputes quantity");
    await order.getByRole("button", { name: "Resolve dispute" }).click();
    const dialog = page.getByRole("dialog", { name: /Resolve disputed delivery/ });
    await dialog.getByLabel("Agreed outcome").selectOption("PARTIALLY_DELIVERED");
    await dialog.getByLabel(/Delivered quantity/).fill("600"); // more than the 500 kg ordered
    await dialog.getByLabel("Resolution remarks").fill("Synthetic: 2 cartons credited");
    await dialog.getByRole("button", { name: "Resolve dispute" }).click();
    await expect(dialog.getByText("A partial delivery must be less than the ordered 500 kg.").first()).toBeVisible();
    await dialog.getByLabel(/Delivered quantity/).fill("450");
    await dialog.getByRole("button", { name: "Resolve dispute" }).click();
    await expect(dialog.getByText("Describe the shortage or damage.").first()).toBeVisible();
    expect(calls(api, "PATCH", "/api/pods/41")).toHaveLength(0);
    await dialog.getByLabel("Shortage details").fill("Synthetic: 2 cartons short");
    await dialog.getByRole("button", { name: "Resolve dispute" }).click();
    await expect(dialog).toBeHidden();
    expect(calls(api, "PATCH", "/api/pods/41")[0].body).toEqual({ status: "PARTIALLY_DELIVERED", remarks: "Synthetic: 2 cartons credited", deliveredQuantity: 450, shortageDetails: "Synthetic: 2 cartons short", damageDetails: null });
  });

  test("adds delivery photos later and opens existing ones", async ({ page, api }) => {
    await page.goto("/trips/1");
    const order = page.getByRole("region", { name: /ORD-QA0001/ });
    await expect(order.getByRole("button", { name: "Open delivery photo 1" })).toBeVisible();
    await order.getByRole("button", { name: "Add photos" }).click();
    const dialog = page.getByRole("dialog", { name: /Add delivery photos/ });
    await expect(dialog).toContainText("1 of 8 photos attached");
    await dialog.getByRole("group", { name: "Delivery photos" }).locator('input[type="file"]:not([capture])').setInputFiles({ name: "later.png", mimeType: "image/png", buffer: Buffer.from(TINY_PNG.split(",")[1], "base64") });
    await dialog.getByRole("button", { name: "Upload photos" }).click();
    await expect(dialog).toBeHidden();
    expect(String(calls(api, "POST", "/api/pods/41/photos")[0].body)).toMatch(/name="photos"; filename="later\.(png|jpg)"/);
  });
});

test.describe("disputed proof of delivery (employee)", () => {
  test.use({ role: "EMPLOYEE", overrides: { "GET /api/trips/1/documents": withDisputedPod } });
  test("employees see the dispute but cannot resolve it or add photos", async ({ page }) => {
    await page.goto("/trips/1");
    const order = page.getByRole("region", { name: /ORD-QA0001/ });
    await expect(order).toContainText("A manager or admin resolves disputed deliveries.");
    await expect(order.getByRole("button", { name: "Resolve dispute" })).toHaveCount(0);
    await expect(order.getByRole("button", { name: "Add photos" })).toHaveCount(0);
  });
});

test.describe("order drawer paperwork", () => {
  test("lists the order's E-Way Bills, lorry receipts and PODs with links", async ({ page }) => {
    await page.goto("/orders?open=1");
    const drawer = page.getByRole("dialog", { name: /ORD-QA0001/ });
    const docs = drawer.getByRole("region", { name: "Transport documents" });
    await expect(docs.getByRole("link", { name: "E-Way Bill 3910 1234 5678" })).toHaveAttribute("href", "/transport-documents/eway-bills/11");
    await expect(docs.getByRole("link", { name: "LR LR-20261118-QA0001" })).toHaveAttribute("href", "/transport-documents/lorry-receipts/21");
    await expect(docs.getByRole("link", { name: /POD · QA Receiver/ })).toHaveAttribute("href", "/api/pods/31/pdf");
  });
});
