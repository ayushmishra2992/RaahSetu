import { describe, expect, it } from "vitest";
import { validateBilling } from "./billing";
import { decodeImage, fileProblem, fitWithin, jpegName, PHOTO_MIME, rotatedSize } from "./upload";

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("fileProblem", () => {
  it("accepts PDFs and common photo formats", () => {
    expect(fileProblem(f("rc.pdf", "application/pdf"))).toBeNull();
    expect(fileProblem(f("rc.jpg", "image/jpeg"))).toBeNull();
    expect(fileProblem(f("rc.webp", "image/webp"))).toBeNull();
  });

  it("explains rejected files", () => {
    expect(fileProblem(f("x.pdf", "application/pdf", 0))).toMatch(/empty/);
    expect(fileProblem(f("IMG_1.HEIC", "image/heic"))).toMatch(/HEIC/);
    expect(fileProblem(f("IMG_1.heic", ""))).toMatch(/HEIC/);
    expect(fileProblem(f("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).toMatch(/Use PDF, JPG, PNG, WEBP/);
    expect(fileProblem(f("big.pdf", "application/pdf", 6 * 1024 * 1024))).toMatch(/limit is 5 MB/);
    expect(fileProblem(f("scan.pdf", "application/pdf"), PHOTO_MIME)).toMatch(/Use JPG, PNG/);
  });

  it("does not size-limit images, which are compressed before upload", () => {
    expect(fileProblem(f("camera.jpg", "image/jpeg", 12 * 1024 * 1024))).toBeNull();
  });
});

describe("image geometry", () => {
  it("fits within the maximum without upscaling", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600, 1600)).toEqual({ width: 0, height: 0 });
  });

  it("swaps dimensions for quarter turns", () => {
    expect(rotatedSize(1600, 1200, 1)).toEqual({ width: 1200, height: 1600 });
    expect(rotatedSize(1600, 1200, 2)).toEqual({ width: 1600, height: 1200 });
  });

  it("names compressed photos .jpg", () => {
    expect(jpegName("IMG_2024.PNG")).toBe("IMG_2024.jpg");
    expect(jpegName("")).toBe("photo.jpg");
  });
});

describe("billing HSN validation", () => {
  const base = { customerName: "Delhi Traders", customerGstin: "", taxRatePercent: "18", kind: "INVOICE" as const };
  const item = (hsnCode?: string) => ({ description: "Freight", quantity: "1", unit: "trip", rate: "100", hsnCode });
  it("accepts 4, 6 and 8 digit codes or none", () => {
    for (const h of [undefined, "", "9965", "996511", "99651100"]) expect(validateBilling(base, [item(h)]).itemRows).toBeUndefined();
  });
  it("rejects other lengths and letters", () => {
    for (const h of ["12", "12345", "99A5"]) expect(validateBilling(base, [item(h)]).itemRows?.[0]).toMatch(/HSN/);
  });
});

describe("decodeImage fallbacks", () => {
  const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const bitmap = (w: number, h: number) => ({ width: w, height: h, close: () => undefined }) as unknown as ImageBitmap;

  it("uses createImageBitmap with EXIF orientation when supported", async () => {
    const calls: unknown[] = [];
    const img = await decodeImage(blob, { createImageBitmap: (async (_b: Blob, o?: ImageBitmapOptions) => (calls.push(o), bitmap(40, 30))) as typeof createImageBitmap });
    expect([img.width, img.height]).toEqual([40, 30]);
    expect(calls).toEqual([{ imageOrientation: "from-image" }]);
  });

  it("retries without options when the browser rejects them", async () => {
    const calls: unknown[] = [];
    const cib = (async (_b: Blob, o?: ImageBitmapOptions) => {
      calls.push(o);
      if (o) throw new TypeError("options not supported");
      return bitmap(20, 10);
    }) as typeof createImageBitmap;
    const img = await decodeImage(blob, { createImageBitmap: cib });
    expect(img.width).toBe(20);
    expect(calls).toEqual([{ imageOrientation: "from-image" }, undefined]);
  });

  it("falls back to an <img> element when createImageBitmap fails or is missing", async () => {
    const fake = { naturalWidth: 300, naturalHeight: 200, width: 0, height: 0 } as HTMLImageElement;
    const failing = (async () => {
      throw new Error("unsupported");
    }) as unknown as typeof createImageBitmap;
    const img = await decodeImage(blob, { createImageBitmap: failing, loadImage: async () => fake });
    expect([img.width, img.height]).toEqual([300, 200]);
    expect(img.source).toBe(fake);
    img.close();
  });

  it("explains when no decoder can read the photo", async () => {
    const failing = (async () => {
      throw new Error("unsupported");
    }) as unknown as typeof createImageBitmap;
    await expect(decodeImage(blob, { createImageBitmap: failing, loadImage: async () => Promise.reject(new Error("bad")) })).rejects.toThrow(/could not be read by your browser/);
  });
});
