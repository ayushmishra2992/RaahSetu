import { describe, expect, it } from "vitest";
import { orderBody, validateOrder, type OrderDraft } from "./validate";

const ok: OrderDraft = {
  customerName: "Kurla Traders",
  customerPhone: "",
  pickupLocationId: "2",
  dropLocationId: "3",
  weightKg: "750",
  priority: "NORMAL",
  serviceMinutes: "20",
  notes: "",
  declaredValue: "",
  readyAt: null,
  windowStart: "2026-11-12T10:00:00.000Z",
  windowEnd: "2026-11-12T18:00:00.000Z",
};

describe("order validation", () => {
  it("accepts a valid order", () => {
    expect(validateOrder(ok)).toEqual({});
  });

  it("mirrors the backend rules", () => {
    const e = validateOrder({ ...ok, customerName: "K", dropLocationId: "2", weightKg: "12.5", serviceMinutes: "700", windowEnd: "2026-11-12T09:00:00.000Z" });
    expect(Object.keys(e).sort()).toEqual(["customerName", "dropLocationId", "serviceMinutes", "weightKg", "windowEnd"]);
    expect(e.dropLocationId).toMatch(/different/);
  });

  it("builds the same body shape the API expects", () => {
    expect(orderBody({ ...ok, customerPhone: "  ", declaredValue: "5000" })).toMatchObject({ customerName: "Kurla Traders", customerPhone: null, pickupLocationId: 2, dropLocationId: 3, weightKg: 750, serviceMinutes: 20, declaredValue: 5000, notes: null });
  });
});
