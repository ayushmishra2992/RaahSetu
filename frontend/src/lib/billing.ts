/**
 * Client mirror of backend/src/modules/billing (computeTotals + BillingBody).
 * Used only for the live preview and field validation; the server
 * recalculates and stores the authoritative amounts.
 */
export type BillingKind = "INVOICE" | "DELIVERY_CHALLAN";

export interface DraftItem {
  hsnCode?: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeTotals(items: Array<{ quantity: number; rate: number }>, taxRatePercent: number, kind: BillingKind) {
  const amounts = items.map((i) => round2(i.quantity * i.rate));
  const subtotal = round2(amounts.reduce((a, b) => a + b, 0));
  const rate = kind === "DELIVERY_CHALLAN" ? 0 : taxRatePercent;
  const taxAmount = round2((subtotal * rate) / 100);
  return { amounts, subtotal, taxRatePercent: rate, taxAmount, total: round2(subtotal + taxAmount) };
}

export const GSTIN_PATTERN = /^[0-9A-Z]{15}$/;

export interface BillingErrors {
  customerName?: string;
  customerGstin?: string;
  taxRatePercent?: string;
  items?: string;
  itemRows?: Record<number, string>;
}

export function validateBilling(f: { customerName: string; customerGstin: string; taxRatePercent: string; kind: BillingKind }, items: DraftItem[]): BillingErrors {
  const e: BillingErrors = {};
  const name = f.customerName.trim();
  if (name.length < 2 || name.length > 120) e.customerName = "Enter the customer name (2–120 characters).";
  const gstin = f.customerGstin.trim().toUpperCase();
  if (gstin && !GSTIN_PATTERN.test(gstin)) e.customerGstin = "GSTIN must be 15 letters or digits.";
  if (f.kind === "INVOICE") {
    const t = Number(f.taxRatePercent);
    if (f.taxRatePercent === "" || !(t >= 0 && t <= 28)) e.taxRatePercent = "GST rate must be between 0 and 28%.";
  }
  if (items.length < 1 || items.length > 50) e.items = "Add between 1 and 50 line items.";
  const rows: Record<number, string> = {};
  items.forEach((it, i) => {
    const q = Number(it.quantity);
    const r = Number(it.rate || 0);
    if (!it.description.trim()) rows[i] = "Description is required.";
    else if (it.description.trim().length > 200) rows[i] = "Description is limited to 200 characters.";
    else if (!(q > 0) || q > 1e6) rows[i] = "Quantity must be more than 0.";
    else if (!(r >= 0) || r > 1e9) rows[i] = "Rate can't be negative.";
    else if (it.unit.length > 20) rows[i] = "Unit is limited to 20 characters.";
    else if (it.hsnCode?.trim() && !/^\d{4}(\d{2}){0,2}$/.test(it.hsnCode.trim())) rows[i] = "HSN/SAC code must be 4, 6 or 8 digits.";
  });
  if (Object.keys(rows).length) e.itemRows = rows;
  return e;
}

export const hasErrors = (e: BillingErrors) => Object.keys(e).length > 0;
