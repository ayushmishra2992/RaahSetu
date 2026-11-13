import { describe, expect, it } from "vitest";
import { computeTotals, validateBilling } from "./billing";

describe("billing totals (mirror of the backend)", () => {
  it("rounds each line, then applies one GST rate to the subtotal", () => {
    const t = computeTotals([{ quantity: 3, rate: 33.333 }, { quantity: 1.5, rate: 1000.01 }], 18, "INVOICE");
    expect(t.amounts).toEqual([100, 1500.02]); // 99.999 → 100.00; 1500.015 → 1500.02
    expect(t.subtotal).toBe(1600.02);
    expect(t.taxAmount).toBe(288);
    expect(t.total).toBe(1888.02);
  });

  it("never taxes delivery challans", () => {
    const t = computeTotals([{ quantity: 2, rate: 500 }], 18, "DELIVERY_CHALLAN");
    expect(t.taxRatePercent).toBe(0);
    expect(t.total).toBe(1000);
  });
});

describe("billing validation", () => {
  const base = { customerName: "Thane Distributors", customerGstin: "", taxRatePercent: "18", kind: "INVOICE" as const };
  const item = { description: "Freight", quantity: "1", unit: "trip", rate: "100" };
  it("accepts a valid draft", () => {
    expect(validateBilling(base, [item])).toEqual({});
  });
  it("mirrors the backend rules", () => {
    const e = validateBilling({ ...base, customerName: "T", customerGstin: "27ABC", taxRatePercent: "30" }, [{ ...item, quantity: "0" }, { ...item, description: " " }]);
    expect(e.customerName).toBeTruthy();
    expect(e.customerGstin).toMatch(/15/);
    expect(e.taxRatePercent).toBeTruthy();
    expect(e.itemRows).toEqual({ 0: "Quantity must be more than 0.", 1: "Description is required." });
  });
  it("ignores the tax rate on challans", () => {
    expect(validateBilling({ ...base, kind: "DELIVERY_CHALLAN", taxRatePercent: "" }, [item])).toEqual({});
  });
});
