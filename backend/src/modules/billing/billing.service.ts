import { round } from "../../lib/numbering";

export interface LineItemInput {
  description: string;
  quantity: number;
  unit?: string;
  rate: number;
}

/** GST is applied as a single percentage on the subtotal. Challans carry no tax. */
export function computeTotals(items: LineItemInput[], taxRatePercent: number, kind: "INVOICE" | "DELIVERY_CHALLAN") {
  const lines = items.map((i) => ({ ...i, unit: i.unit ?? "nos", amount: round(i.quantity * i.rate, 2) }));
  const subtotal = round(lines.reduce((a, l) => a + l.amount, 0), 2);
  const rate = kind === "DELIVERY_CHALLAN" ? 0 : taxRatePercent;
  const taxAmount = round((subtotal * rate) / 100, 2);
  return { lines, subtotal, taxRatePercent: rate, taxAmount, total: round(subtotal + taxAmount, 2) };
}
