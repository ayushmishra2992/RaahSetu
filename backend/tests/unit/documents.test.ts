import { inflateRawSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { fmtDate, rs, STANDARD_DISCLAIMER, t } from "../../src/lib/pdf";
import { assertAllowedFile, safeFileName, signFileToken, verifyFileToken } from "../../src/lib/storage";
import { createZip, safeZipName } from "../../src/lib/zip";
import { billingPdf, lrBalance, lrFooterNote, lrPdf } from "../../src/modules/shipments/pdfs";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = Buffer.from("%PDF-1.7\n");

/** Reads entries back out of a ZIP produced by createZip (independent of the writer's bookkeeping). */
function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const lName = zip.readUInt16LE(local + 26);
    const body = zip.subarray(local + 30 + lName, local + 30 + lName + size);
    out[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    p += 46 + nameLen;
  }
  return out;
}

describe("upload validation", () => {
  it("accepts allowed types whose bytes and extension match", () => {
    expect(() => assertAllowedFile("image/png", PNG, "rc.png")).not.toThrow();
    expect(() => assertAllowedFile("image/jpeg", JPG, "photo.JPEG")).not.toThrow();
    expect(() => assertAllowedFile("application/pdf", PDF, "ins.pdf")).not.toThrow();
    expect(() => assertAllowedFile("image/jpeg", JPG, "blob")).not.toThrow(); // camera capture without extension
  });

  it("rejects spoofed content, wrong extensions, empty files and other types", () => {
    expect(() => assertAllowedFile("application/pdf", PNG, "x.pdf")).toThrow(/does not match/);
    expect(() => assertAllowedFile("image/png", PNG, "x.exe")).toThrow(/extension/);
    expect(() => assertAllowedFile("image/png", Buffer.alloc(0), "x.png")).toThrow(/empty/);
    expect(() => assertAllowedFile("image/svg+xml", Buffer.from("<svg/>"), "x.svg")).toThrow(/not allowed/);
    expect(() => assertAllowedFile("application/pdf", PDF, "x.pdf", ["image/jpeg", "image/png"])).toThrow(/not allowed/);
  });

  it("makes display names safe", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\scan 1.pdf")).toBe("scan 1.pdf");
    expect(safeFileName('a"b<c>.png')).toBe("a_b_c_.png");
    expect(safeFileName("")).toBe("document");
    expect(safeFileName("x".repeat(400)).length).toBe(150);
  });
});

describe("signed download links", () => {
  const key = "0123456789abcdef0123456789abcdef";
  it("round-trips a valid token", () => {
    const tok = signFileToken({ c: 7, k: key, n: "rc.pdf", m: "application/pdf" }, 300);
    expect(verifyFileToken(tok)).toMatchObject({ c: 7, k: key, n: "rc.pdf" });
  });

  it("rejects expired, tampered and malformed tokens", () => {
    const tok = signFileToken({ c: 7, k: key, n: "rc.pdf", m: "application/pdf" }, 60, Date.now() - 120_000);
    expect(verifyFileToken(tok)).toBeNull();
    const good = signFileToken({ c: 7, k: key, n: "rc.pdf", m: "application/pdf" }, 300);
    const [body, sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ c: 8, k: key, n: "rc.pdf", m: "application/pdf", e: 9e9 })).toString("base64url");
    expect(verifyFileToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyFileToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyFileToken("nonsense")).toBeNull();
  });

  it("refuses tokens that point outside the storage key format", () => {
    const tok = signFileToken({ c: 7, k: "../../secret", n: "x", m: "application/pdf" }, 300);
    expect(verifyFileToken(tok)).toBeNull();
  });
});

describe("zip writer", () => {
  it("produces an archive whose entries read back intact", () => {
    const big = Buffer.from("RaahSetu ".repeat(500));
    const zip = createZip([
      { name: "MANIFEST.txt", data: Buffer.from("hello") },
      { name: "docs/रसीद.pdf", data: big },
      { name: "docs/रसीद.pdf", data: PNG },
    ]);
    const files = readZip(zip);
    expect(Object.keys(files)).toEqual(["MANIFEST.txt", "docs/रसीद.pdf", "docs/रसीद (2).pdf"]);
    expect(files["MANIFEST.txt"].toString()).toBe("hello");
    expect(files["docs/रसीद.pdf"].equals(big)).toBe(true);
    expect(files["docs/रसीद (2).pdf"].equals(PNG)).toBe(true);
  });

  it("strips path traversal from entry names", () => {
    expect(safeZipName("../../evil.sh")).toBe("evil.sh");
    expect(safeZipName("/abs\\x/./y.pdf")).toBe("abs/x/y.pdf");
    expect(safeZipName("..")).toBe("file");
  });
});

describe("pdf helpers", () => {
  it("formats rupees, dates and unprintable text", () => {
    expect(rs(125000.5)).toBe("Rs. 1,25,000.50");
    expect(rs(null)).toBe("—");
    expect(fmtDate(new Date("2026-11-18T06:00:00Z"))).toMatch(/18 Nov 2026/);
    expect(t("₹500")).toBe("Rs.500");
    expect(t("गाड़ी")).toBe("?????");
    expect(t(null)).toBe("—");
  });

  const issuer = { name: "Test Transport", address: "Plot 1", city: "Gurugram", state: "Haryana", gstNumber: "06AABCU9603R1ZX", phone: null };

  it("renders a delivery challan and a lorry receipt as PDFs", async () => {
    const challan = await billingPdf({
      kind: "DELIVERY_CHALLAN",
      number: "DC-2026-0001",
      status: "ISSUED",
      issuedAt: new Date(),
      createdAt: new Date(),
      dueDate: null,
      customerName: "Amity University",
      customerGstin: null,
      customerAddress: "Noida",
      taxRatePercent: 0,
      subtotal: 1000,
      taxAmount: 0,
      total: 1000,
      notes: null,
      reasonForTransport: "Supply",
      referenceDocuments: "EWB 123456789012",
      verificationToken: "abcdefghijklmnopqrstuv",
      items: [{ description: "Lab chairs", hsnCode: "9401", quantity: 10, unit: "nos", rate: 100, amount: 1000 }],
      issuer,
      trip: { tripNumber: "TRP-1", from: "Bennett University", to: "Amity", vehicle: { registrationNumber: "DL5SKR2184", type: "MINI_TRUCK" }, driver: { name: "Ramesh", phone: "+91 90000", licenseNumber: "DL01" } },
    });
    expect(challan.subarray(0, 5).toString()).toBe("%PDF-");
    expect(challan.length).toBeGreaterThan(2000);
    const lrInput = {
      lrNumber: "LR-20261118-ABC123",
      status: "ACTIVE",
      bookingDate: new Date(),
      consignorName: "Test Transport",
      consignorAddress: null,
      consignorGstin: null,
      consigneeName: "Amity",
      consigneeAddress: null,
      consigneeGstin: null,
      fromPlace: "Greater Noida",
      toPlace: "Noida",
      goodsDescription: "Chairs",
      packages: 10,
      packageType: "boxes",
      actualWeightKg: 250,
      chargedWeightKg: 300,
      freightAmount: 4500,
      advanceAmount: 1500,
      paymentTerms: "TO_PAY",
      declaredValue: 60000,
      deliveryInstructions: null,
      finalizedAt: null,
      cancelReason: null,
      terms: null,
      orderNumber: "ORD-1",
      ewayBills: ["123456789012"],
      issuer,
      trip: null,
    };
    // Draft, finalized (with company terms) and cancelled variants all render.
    for (const variant of [lrInput, { ...lrInput, finalizedAt: new Date(), terms: "Company terms line 1" }, { ...lrInput, status: "CANCELLED", cancelReason: "Wrong consignee" }]) {
      const lr = await lrPdf(variant);
      expect(lr.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("prints the draft notice AND the standard disclaimer on draft LRs, and only the disclaimer otherwise", async () => {
    // Footer text logic.
    expect(lrFooterNote(true)).toContain("has not been finalized");
    expect(lrFooterNote(true)).toContain(STANDARD_DISCLAIMER);
    expect(lrFooterNote(false)).toBe(STANDARD_DISCLAIMER);

    // And in the rendered PDF itself (text read back from the decompressed content streams).
    const base = {
      lrNumber: "LR-20261119-PDF001", status: "ACTIVE", bookingDate: new Date(), consignorName: "Synthetic Transport", consignorAddress: null, consignorGstin: null,
      consigneeName: "Synthetic Consignee", consigneeAddress: null, consigneeGstin: null, fromPlace: "A", toPlace: "B", goodsDescription: "Synthetic goods",
      packages: null, packageType: null, actualWeightKg: null, chargedWeightKg: null, freightAmount: null, advanceAmount: null, paymentTerms: "TO_BE_BILLED",
      declaredValue: null, deliveryInstructions: null, finalizedAt: null as Date | null, cancelReason: null as string | null, terms: null, orderNumber: "ORD-1", ewayBills: [],
      issuer: { name: "Synthetic Transport", address: null, city: null, state: null, gstNumber: null, phone: null }, trip: null,
    };
    const disclaimer = squash("it is not a government (GST, E-Way Bill or VAHAN) verification");
    const draftNotice = squash("this lorry receipt has not been finalized");
    const draft = pdfText(await lrPdf(base));
    expect(draft).toContain(draftNotice);
    expect(draft).toContain(disclaimer);
    const final = pdfText(await lrPdf({ ...base, finalizedAt: new Date() }));
    expect(final).toContain(disclaimer);
    expect(final).not.toContain(draftNotice);
    const cancelled = pdfText(await lrPdf({ ...base, status: "CANCELLED", cancelReason: "Synthetic duplicate" }));
    expect(cancelled).toContain(disclaimer);
    expect(cancelled).not.toContain(draftNotice);
  });

  it("computes the LR balance as freight minus advance, rounded to paise", () => {
    expect(lrBalance(4500, 1500)).toBe(3000);
    expect(lrBalance(4500, null)).toBe(4500);
    expect(lrBalance(100.1, 33.37)).toBe(66.73);
    expect(lrBalance(null, null)).toBeNull();
  });
});

/** Lower-case text without whitespace, so wrapped lines and kerning splits don't matter when comparing. */
function squash(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

/** Text drawn in a PDFKit PDF: inflate each content stream and decode its hex text strings. */
function pdfText(pdf: Buffer) {
  const raw = pdf.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    let body: string;
    try {
      body = inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      continue; // not a deflated stream (e.g. an image)
    }
    for (const h of body.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], "hex").toString("latin1");
  }
  return squash(out);
}
