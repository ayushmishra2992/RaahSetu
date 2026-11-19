import { env } from "../../config/env";
import { boxes, fields, fmtDate, footer, header, paragraph, renderPdf, rs, sectionTitle, signatures, table } from "../../lib/pdf";

export const verifyUrl = (token: string) => `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/verify/${token}`;

interface Issuer {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  gstNumber: string | null;
  phone: string | null;
}

interface TripInfo {
  tripNumber: string;
  vehicle: { registrationNumber: string; type: string };
  driver: { name: string; phone: string; licenseNumber: string };
}

// ───────────────────────── Invoice & delivery challan ─────────────────────────

export interface BillingPdfInput {
  kind: "INVOICE" | "DELIVERY_CHALLAN";
  number: string;
  status: string;
  issuedAt: Date | null;
  createdAt: Date;
  dueDate: Date | null;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  taxRatePercent: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  reasonForTransport: string | null;
  referenceDocuments: string | null;
  verificationToken: string;
  items: Array<{ description: string; hsnCode: string | null; quantity: number; unit: string; rate: number; amount: number }>;
  issuer: Issuer;
  trip: (TripInfo & { from: string | null; to: string | null }) | null;
}

export function billingPdf(d: BillingPdfInput) {
  const challan = d.kind === "DELIVERY_CHALLAN";
  const title = challan ? "Delivery Challan" : "Tax Invoice";
  return renderPdf(
    async (doc) => {
      header(doc, {
        title,
        number: d.number,
        date: d.issuedAt ?? d.createdAt,
        issuer: d.issuer,
        extra: [["Status", d.status], ...(d.dueDate && !challan ? ([["Due", fmtDate(d.dueDate)]] as Array<[string, string]>) : [])],
      });
      boxes(doc, [
        { title: challan ? "Consignor" : "Supplier", lines: [d.issuer.name, d.issuer.address, [d.issuer.city, d.issuer.state].filter(Boolean).join(", "), d.issuer.gstNumber ? `GSTIN: ${d.issuer.gstNumber}` : null] },
        { title: challan ? "Consignee" : "Bill to", lines: [d.customerName, d.customerAddress, d.customerGstin ? `GSTIN: ${d.customerGstin}` : null] },
      ]);
      if (d.trip || challan) {
        sectionTitle(doc, "Transport");
        fields(doc, [
          ["Trip", d.trip?.tripNumber],
          ["Vehicle", d.trip ? `${d.trip.vehicle.registrationNumber} (${d.trip.vehicle.type.replace("_", " ").toLowerCase()})` : null],
          ["Driver", d.trip ? `${d.trip.driver.name}, ${d.trip.driver.phone}` : null],
          ["Driving licence", d.trip?.driver.licenseNumber],
          ["From", d.trip?.from],
          ["To", d.trip?.to],
          ...(challan ? ([["Reason for transport", d.reasonForTransport]] as Array<[string, string | null]>) : []),
          ["Reference documents", d.referenceDocuments],
        ]);
      }
      sectionTitle(doc, "Items");
      table(
        doc,
        [
          { header: "#", width: 0.05 },
          { header: "Description", width: challan ? 0.47 : 0.35 },
          { header: "HSN/SAC", width: 0.12 },
          { header: "Qty", width: 0.1, align: "right" },
          { header: "Unit", width: 0.08 },
          ...(challan ? [{ header: "Value", width: 0.18, align: "right" as const }] : [{ header: "Rate", width: 0.13, align: "right" as const }, { header: "Amount", width: 0.17, align: "right" as const }]),
        ],
        d.items.map((it, i) => [i + 1, it.description, it.hsnCode, it.quantity, it.unit, ...(challan ? [rs(it.amount)] : [rs(it.rate), rs(it.amount)])]),
      );
      if (challan) {
        fields(doc, [["Total value of goods", rs(d.subtotal)]], 1);
        paragraph(doc, "Note", "This delivery challan accompanies goods in transit. It is not a tax invoice.");
      } else {
        fields(
          doc,
          [
            ["Subtotal", rs(d.subtotal)],
            [`GST (${d.taxRatePercent}%)`, rs(d.taxAmount)],
            ["Total", rs(d.total)],
          ],
          3,
        );
      }
      paragraph(doc, "Notes", d.notes);
      signatures(doc, challan ? ["Receiver's signature & stamp", `For ${d.issuer.name} (authorised signatory)`] : [`For ${d.issuer.name} (authorised signatory)`]);
      await footer(doc, { verifyUrl: d.status === "DRAFT" ? null : verifyUrl(d.verificationToken), note: d.status === "DRAFT" ? "DRAFT — not issued. Draft documents are not valid and cannot be verified." : undefined });
    },
    { title: `${title} ${d.number}` },
  );
}

// ───────────────────────── Lorry receipt ─────────────────────────

export interface LrPdfInput {
  lrNumber: string;
  status: string;
  bookingDate: Date;
  consignorName: string;
  consignorAddress: string | null;
  consignorGstin: string | null;
  consigneeName: string;
  consigneeAddress: string | null;
  consigneeGstin: string | null;
  fromPlace: string;
  toPlace: string;
  goodsDescription: string;
  packages: number | null;
  packageType: string | null;
  actualWeightKg: number | null;
  chargedWeightKg: number | null;
  freightAmount: number | null;
  paymentTerms: string;
  declaredValue: number | null;
  deliveryInstructions: string | null;
  orderNumber: string;
  ewayBills: string[];
  issuer: Issuer;
  trip: TripInfo | null;
}

const TERMS: Record<string, string> = { PAID: "Paid", TO_PAY: "To pay (collect from consignee)", TO_BE_BILLED: "To be billed" };

export function lrPdf(d: LrPdfInput) {
  return renderPdf(
    (doc) => {
      header(doc, { title: "Lorry Receipt", number: d.lrNumber, date: d.bookingDate, issuer: d.issuer, extra: [["Order", d.orderNumber], ...(d.status === "CANCELLED" ? ([["Status", "CANCELLED"]] as Array<[string, string]>) : [])] });
      boxes(doc, [
        { title: "Consignor", lines: [d.consignorName, d.consignorAddress, d.consignorGstin ? `GSTIN: ${d.consignorGstin}` : null] },
        { title: "Consignee", lines: [d.consigneeName, d.consigneeAddress, d.consigneeGstin ? `GSTIN: ${d.consigneeGstin}` : null] },
      ]);
      fields(doc, [
        ["From", d.fromPlace],
        ["To", d.toPlace],
        ["Booking date", fmtDate(d.bookingDate)],
        ["Vehicle", d.trip?.vehicle.registrationNumber],
        ["Driver", d.trip ? `${d.trip.driver.name}, ${d.trip.driver.phone}` : null],
        ["Trip", d.trip?.tripNumber],
      ]);
      sectionTitle(doc, "Goods");
      table(
        doc,
        [
          { header: "Description", width: 0.4 },
          { header: "Packages", width: 0.15, align: "right" },
          { header: "Actual wt (kg)", width: 0.15, align: "right" },
          { header: "Charged wt (kg)", width: 0.15, align: "right" },
          { header: "Declared value", width: 0.15, align: "right" },
        ],
        [[d.goodsDescription, d.packages != null ? `${d.packages}${d.packageType ? ` ${d.packageType}` : ""}` : null, d.actualWeightKg, d.chargedWeightKg, rs(d.declaredValue)]],
      );
      sectionTitle(doc, "Freight");
      fields(doc, [
        ["Freight", rs(d.freightAmount)],
        ["Payment terms", TERMS[d.paymentTerms] ?? d.paymentTerms],
        ["E-Way Bill(s)", d.ewayBills.length ? d.ewayBills.join(", ") : null],
      ]);
      paragraph(doc, "Delivery instructions", d.deliveryInstructions);
      paragraph(doc, "Terms", "Goods are carried at owner's risk unless insured. The consignee must check the goods on delivery and note any shortage or damage on this receipt.");
      signatures(doc, ["Consignor's signature", "Receiver's signature, date & stamp", `For ${d.issuer.name}`]);
      return footer(doc, {});
    },
    { title: `Lorry Receipt ${d.lrNumber}` },
  );
}

// ───────────────────────── Proof of delivery ─────────────────────────

export interface PodPdfInput {
  status: string;
  receiverName: string;
  receiverPhone: string | null;
  deliveredAt: Date;
  deliveredQuantity: number | null;
  orderedQuantity: number | null;
  shortageDetails: string | null;
  damageDetails: string | null;
  remarks: string | null;
  verificationToken: string;
  orderNumber: string | null;
  customerName: string | null;
  dropLocation: string;
  issuer: Issuer;
  trip: TripInfo;
  signature: Buffer | null;
  photos: Buffer[];
  recordedAt: Date;
}

const POD_STATUS: Record<string, string> = {
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partially delivered",
  FAILED: "Delivery failed",
  RETURNED: "Returned",
  DISPUTED: "Disputed",
};

export function podPdf(d: PodPdfInput) {
  return renderPdf(
    async (doc) => {
      header(doc, { title: "Proof of Delivery", number: d.orderNumber ?? d.trip.tripNumber, date: d.deliveredAt, issuer: d.issuer, extra: [["Status", POD_STATUS[d.status] ?? d.status]] });
      fields(doc, [
        ["Order", d.orderNumber],
        ["Customer", d.customerName],
        ["Delivered to", d.dropLocation],
        ["Trip", d.trip.tripNumber],
        ["Vehicle", d.trip.vehicle.registrationNumber],
        ["Driver", d.trip.driver.name],
        ["Received by", d.receiverName],
        ["Receiver phone", d.receiverPhone],
        ["Delivered at", fmtDate(d.deliveredAt, true)],
        ["Ordered (kg)", d.orderedQuantity],
        ["Delivered (kg)", d.deliveredQuantity],
        ["Recorded", fmtDate(d.recordedAt, true)],
      ]);
      paragraph(doc, "Shortage", d.shortageDetails);
      paragraph(doc, "Damage", d.damageDetails);
      paragraph(doc, "Remarks", d.remarks);
      if (d.photos.length) {
        sectionTitle(doc, `Delivery photographs (${d.photos.length})`);
        const size = 120;
        let x = 40;
        const y = doc.y;
        for (const p of d.photos.slice(0, 4)) {
          try {
            doc.image(p, x, y, { fit: [size, size] });
          } catch {
            doc.fontSize(8).text("(image could not be embedded)", x, y + size / 2, { width: size });
          }
          x += size + 8;
        }
        doc.y = y + size + 10;
        doc.x = 40;
      }
      signatures(doc, ["Receiver's signature", `For ${d.issuer.name}`], d.signature);
      await footer(doc, { verifyUrl: verifyUrl(d.verificationToken) });
    },
    { title: `Proof of Delivery ${d.orderNumber ?? ""}` },
  );
}
