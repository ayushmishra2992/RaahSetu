import { describe, expect, it } from "vitest";
import type { RunResult } from "@/lib/types";
import { compareRuns, sameOrders, verdict } from "./compare";

const result = (over: { served: number; km: number; orders: string[] }) =>
  ({
    objective: { total: over.km * 10 },
    totals: { servedOrders: over.served, vehiclesUsed: 2, distanceKm: over.km, durationMin: 100, operatingCost: 1000, co2Kg: 10, latenessMin: 0 },
    unserved: [],
    runtimeMs: 50,
    orders: Object.fromEntries(over.orders.map((k) => [k, { label: k }])),
  }) as unknown as RunResult;

describe("run comparison", () => {
  it("judges direction per metric", () => {
    expect(verdict(-5, "lower")).toBe("better");
    expect(verdict(5, "lower")).toBe("worse");
    expect(verdict(1, "higher")).toBe("better");
    expect(verdict(-1, "higher")).toBe("worse");
    expect(verdict(3, "neutral")).toBe("neutral");
    expect(verdict(0, "lower")).toBe("same");
  });

  it("marks more served orders as better even though the number went up", () => {
    const rows = compareRuns(result({ served: 3, km: 100, orders: ["1", "2", "3"] }), result({ served: 4, km: 120, orders: ["1", "2", "3"] }));
    expect(rows.find((r) => r.key === "served")?.verdict).toBe("better");
    expect(rows.find((r) => r.key === "distance")?.verdict).toBe("worse");
    expect(rows.find((r) => r.key === "vehicles")?.verdict).toBe("same");
  });

  it("detects runs over different order sets", () => {
    expect(sameOrders(result({ served: 1, km: 1, orders: ["1", "2"] }), result({ served: 1, km: 1, orders: ["2", "1"] }))).toBe(true);
    expect(sameOrders(result({ served: 1, km: 1, orders: ["1", "2"] }), result({ served: 1, km: 1, orders: ["1"] }))).toBe(false);
  });
});
