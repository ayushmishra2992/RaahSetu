import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/**
 * Shared layout for RaahSetu's printable documents (challan, LR, invoice, POD).
 * Uses PDFKit's built-in Helvetica (no font files to ship). Helvetica has no ₹
 * glyph, so amounts are printed as "Rs." — never as a broken character.
 */

export type Doc = PDFKit.PDFDocument;

const BRAND = "#147060";
const INK = "#1f2933";
const MUTED = "#5f6b7a";
const LINE = "#d5dbe1";
export const MARGIN = 40;

export function rs(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(d: Date | null | undefined, withTime = false) {
  if (!d) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
}

/** Text with the dash placeholder for empty values; strips characters Helvetica cannot draw. */
export function t(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/\u20b9/g, "Rs.").replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, "?");
}

export function renderPdf(build: (doc: Doc) => void | Promise<void>, meta: { title: string; subject?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: meta.title, Subject: meta.subject ?? meta.title, Creator: "RaahSetu", Producer: "RaahSetu" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    Promise.resolve(build(doc))
      .then(() => doc.end())
      .catch((e) => {
        reject(e);
        doc.end();
      });
  });
}

const width = (doc: Doc) => doc.page.width - MARGIN * 2;

/** Brand bar, issuer block and the document title/number on the right. */
export function header(
  doc: Doc,
  o: { title: string; number: string; date: Date | null; issuer: { name: string; address?: string | null; city?: string | null; state?: string | null; gstNumber?: string | null; phone?: string | null }; extra?: Array<[string, string]> },
) {
  doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
  const top = MARGIN;
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(18).text("RaahSetu", MARGIN, top);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text("Fleet & transport operations", MARGIN, doc.y);
  doc.moveDown(0.6);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10.5).text(t(o.issuer.name), MARGIN, doc.y, { width: 280 });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  const addr = [o.issuer.address, [o.issuer.city, o.issuer.state].filter(Boolean).join(", ")].filter(Boolean).join("\n");
  if (addr) doc.text(t(addr), { width: 280 });
  if (o.issuer.gstNumber) doc.text(`GSTIN: ${t(o.issuer.gstNumber)}`, { width: 280 });
  if (o.issuer.phone) doc.text(`Phone: ${t(o.issuer.phone)}`, { width: 280 });
  const leftBottom = doc.y;

  const rx = doc.page.width - MARGIN - 220;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(o.title.toUpperCase(), rx, top, { width: 220, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const rows: Array<[string, string]> = [["No.", o.number], ["Date", fmtDate(o.date)], ...(o.extra ?? [])];
  for (const [k, v] of rows) {
    doc.font("Helvetica").fillColor(MUTED).text(`${k}: `, rx, doc.y + 1, { width: 220, align: "right", continued: true });
    doc.font("Helvetica-Bold").fillColor(INK).text(t(v));
  }
  doc.y = Math.max(leftBottom, doc.y) + 10;
  rule(doc);
}

export function rule(doc: Doc, gap = 8) {
  doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).lineWidth(0.7).strokeColor(LINE).stroke();
  doc.y += gap;
}

export function sectionTitle(doc: Doc, title: string) {
  ensureSpace(doc, 40);
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(9).text(title.toUpperCase(), MARGIN, doc.y, { characterSpacing: 0.4 });
  doc.y += 3;
}

/** Two or three side-by-side labelled boxes (consignor/consignee, from/to…). */
export function boxes(doc: Doc, items: Array<{ title: string; lines: Array<string | null | undefined> }>) {
  ensureSpace(doc, 90);
  const gap = 10;
  const w = (width(doc) - gap * (items.length - 1)) / items.length;
  const top = doc.y;
  let bottom = top;
  items.forEach((it, i) => {
    const x = MARGIN + i * (w + gap);
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text(it.title.toUpperCase(), x + 8, top + 7, { width: w - 16 });
    doc.fillColor(INK).font("Helvetica").fontSize(9);
    const lines = it.lines.filter((l) => l !== null && l !== undefined && l !== "");
    doc.text(lines.length ? lines.map((l) => t(l)).join("\n") : "—", x + 8, doc.y + 2, { width: w - 16 });
    bottom = Math.max(bottom, doc.y + 7);
  });
  items.forEach((_, i) => doc.roundedRect(MARGIN + i * (w + gap), top, w, bottom - top, 4).lineWidth(0.7).strokeColor(LINE).stroke());
  doc.y = bottom + 10;
}

/** Label/value grid. */
export function fields(doc: Doc, pairs: Array<[string, string | number | null | undefined]>, columns = 3) {
  const w = width(doc) / columns;
  for (let i = 0; i < pairs.length; i += columns) {
    ensureSpace(doc, 30);
    const top = doc.y;
    let bottom = top;
    pairs.slice(i, i + columns).forEach(([k, v], j) => {
      const x = MARGIN + j * w;
      doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(k, x, top, { width: w - 8 });
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(t(v), x, doc.y + 1, { width: w - 8 });
      bottom = Math.max(bottom, doc.y);
    });
    doc.y = bottom + 6;
  }
  doc.x = MARGIN;
}

export interface Column {
  header: string;
  width: number; // fraction of the content width
  align?: "left" | "right" | "center";
}

export function table(doc: Doc, columns: Column[], rows: Array<Array<string | number | null | undefined>>) {
  const total = width(doc);
  const xs: number[] = [];
  let acc = MARGIN;
  for (const c of columns) {
    xs.push(acc);
    acc += c.width * total;
  }
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(MARGIN, y, total, 18).fill("#eef8f5");
    columns.forEach((c, i) => doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(8).text(c.header, xs[i] + 4, y + 5, { width: c.width * total - 8, align: c.align ?? "left" }));
    doc.y = y + 20;
  };
  drawHeader();
  for (const r of rows) {
    if (doc.y > doc.page.height - MARGIN - 60) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    let bottom = y;
    columns.forEach((c, i) => {
      doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(t(r[i]), xs[i] + 4, y + 2, { width: c.width * total - 8, align: c.align ?? "left" });
      bottom = Math.max(bottom, doc.y);
    });
    doc.y = bottom + 4;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + total, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y += 2;
  }
  doc.x = MARGIN;
  doc.y += 6;
}

export function paragraph(doc: Doc, label: string, text: string | null | undefined) {
  if (!text) return;
  ensureSpace(doc, 30);
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), MARGIN, doc.y);
  doc.fillColor(INK).font("Helvetica").fontSize(9).text(t(text), MARGIN, doc.y + 1, { width: width(doc) });
  doc.y += 6;
}

/** Signature lines along the bottom of the content; an optional image goes above the first. */
export function signatures(doc: Doc, labels: string[], image?: Buffer | null) {
  ensureSpace(doc, image ? 120 : 80);
  const gap = 20;
  const w = (width(doc) - gap * (labels.length - 1)) / labels.length;
  const top = doc.y + (image ? 70 : 40);
  labels.forEach((l, i) => {
    const x = MARGIN + i * (w + gap);
    if (i === 0 && image) {
      try {
        doc.image(image, x, top - 62, { fit: [w, 58] });
      } catch {
        /* unreadable image: leave the line blank */
      }
    }
    doc.moveTo(x, top).lineTo(x + w, top).lineWidth(0.7).strokeColor(INK).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(l, x, top + 4, { width: w, align: "center" });
  });
  doc.y = top + 24;
}

/** QR code + verification line + disclaimer at the bottom of the last page. */
export async function footer(doc: Doc, o: { verifyUrl?: string | null; note?: string }) {
  ensureSpace(doc, 90);
  const y = doc.y + 6;
  rule(doc, 0);
  if (o.verifyUrl) {
    const png = await QRCode.toBuffer(o.verifyUrl, { margin: 0, width: 160 });
    doc.image(png, MARGIN, y + 6, { width: 62 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8).text("Scan to verify", MARGIN + 72, y + 10);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(o.verifyUrl, MARGIN + 72, doc.y + 1, { width: width(doc) - 72 });
  }
  doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(
    o.note ?? "Generated by RaahSetu from the transporter's records. Verification confirms the record exists in RaahSetu; it is not a government (GST, E-Way Bill or VAHAN) verification.",
    MARGIN + (o.verifyUrl ? 72 : 0),
    o.verifyUrl ? doc.y + 4 : y + 8,
    { width: width(doc) - (o.verifyUrl ? 72 : 0) },
  );
}

export function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - MARGIN) doc.addPage();
}
