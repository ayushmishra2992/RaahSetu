import { describe, expect, it } from "vitest";
import type { Order, Vehicle } from "@/lib/types";
import { preflight } from "./preflight";

const NOW = Date.parse("2026-11-12T08:00:00Z");
const order = (id: number, weightKg: number, extra: Partial<Order> = {}) => ({ id, orderNumber: `O${id}`, weightKg, priority: "NORMAL", windowEnd: null, ...extra }) as Order;
const vehicle = (id: number, capacityKg: number, depot: number | null = 1) => ({ id, registrationNumber: `V${id}`, capacityKg, depotLocationId: depot }) as Vehicle;

describe("OptiRoute pre-flight", () => {
  it("blocks an empty selection", () => {
    expect(preflight({ orders: [], vehicles: [vehicle(1, 1000)], hardTimeWindows: true, planStart: null, now: NOW }).map((c) => c.level)).toEqual(["error"]);
  });

  it("reports a clean selection as ok", () => {
    expect(preflight({ orders: [order(1, 500)], vehicles: [vehicle(1, 1000)], hardTimeWindows: true, planStart: null, now: NOW })).toEqual([{ level: "ok", message: "No issues found in the selection." }]);
  });

  it("flags vehicles without a depot, over-heavy orders and over-capacity load", () => {
    const msgs = preflight({ orders: [order(1, 1500), order(2, 800)], vehicles: [vehicle(1, 1000), vehicle(2, 5000, null)], hardTimeWindows: true, planStart: null, now: NOW }).map((c) => c.message);
    expect(msgs.some((m) => m.includes("no home depot") && m.includes("V2"))).toBe(true);
    expect(msgs.some((m) => m.includes("heavier than the largest eligible vehicle (1000 kg)"))).toBe(true);
    expect(msgs.some((m) => m.includes("exceeds combined capacity"))).toBe(true);
  });

  it("treats windows that close before plan start as unservable only with hard windows", () => {
    const o = [order(1, 100, { windowEnd: "2026-11-12T07:00:00Z" })];
    expect(preflight({ orders: o, vehicles: [vehicle(1, 1000)], hardTimeWindows: true, planStart: null, now: NOW })[0].level).toBe("warning");
    expect(preflight({ orders: o, vehicles: [vehicle(1, 1000)], hardTimeWindows: false, planStart: null, now: NOW })[0].level).toBe("info");
  });
});
