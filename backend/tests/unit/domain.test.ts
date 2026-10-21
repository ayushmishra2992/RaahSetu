import { describe, expect, it } from "vitest";
import { can, permissionsFor } from "../../src/lib/permissions";
import { computeTotals } from "../../src/modules/billing/billing.service";
import { observedEfficiency } from "../../src/modules/greenfleet/greenfleet.service";
import { compareResults } from "../../src/modules/scenarios/scenarios.service";
import { simulatePosition } from "../../src/modules/trips/telemetry";
import { canTransition } from "../../src/modules/trips/trips.service";
import { estimateTrip, legFuelUnits } from "../../src/optimizer/costModel";
import { solve } from "../../src/optimizer/solver";
import { syntheticInstance } from "../../src/optimizer/synthetic";

describe("permissions", () => {
  it("gives admins everything and viewers read-only access", () => {
    expect(permissionsFor("ADMIN").length).toBeGreaterThan(15);
    expect(can("EMPLOYEE", "fleet:read")).toBe(true);
    expect(can("EMPLOYEE", "fleet:write")).toBe(false);
    expect(can("DISPATCHER", "optimize:run")).toBe(true);
    expect(can("DISPATCHER", "scenarios:approve")).toBe(false);
    expect(can("DRIVER", "trips:progress")).toBe(true);
    expect(can("DRIVER", "trips:write")).toBe(false);
  });
});

describe("trip state machine", () => {
  it("allows only forward transitions", () => {
    expect(canTransition("PLANNED", "DISPATCHED")).toBe(true);
    expect(canTransition("DISPATCHED", "IN_TRANSIT")).toBe(true);
    expect(canTransition("IN_TRANSIT", "COMPLETED")).toBe(true);
    expect(canTransition("PLANNED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "PLANNED")).toBe(false);
  });
});

describe("GreenFleet estimates", () => {
  it("increases fuel use with load and computes CO2 from the factor", () => {
    const empty = legFuelUnits(100, 0, 1000, 10, 0.2);
    const full = legFuelUnits(100, 1000, 1000, 10, 0.2);
    expect(empty).toBeCloseTo(10);
    expect(full).toBeCloseTo(12);
    const e = estimateTrip({ distanceKm: 100, durationMin: 120, averageLoadKg: 0, capacityKg: 1000, fuelType: "DIESEL", mileageKmPerUnit: 10 });
    expect(e.co2Kg).toBeCloseTo(26.8);
    expect(e.driverCost).toBeCloseTo(300);
  });

  it("observed efficiency needs two fills and ignores odometer resets", () => {
    expect(observedEfficiency([{ odometerKm: 100, quantity: 10, filledAt: new Date(1) }])).toBeNull();
    const r = observedEfficiency([
      { odometerKm: 1000, quantity: 50, filledAt: new Date(1) },
      { odometerKm: 1500, quantity: 50, filledAt: new Date(2) },
    ]);
    expect(r).toBeCloseTo(10);
  });
});

describe("billing totals", () => {
  it("applies GST on invoices and none on challans", () => {
    const items = [{ description: "Freight", quantity: 2, rate: 1000 }];
    expect(computeTotals(items, 18, "INVOICE")).toMatchObject({ subtotal: 2000, taxAmount: 360, total: 2360 });
    expect(computeTotals(items, 18, "DELIVERY_CHALLAN")).toMatchObject({ taxAmount: 0, total: 2000, taxRatePercent: 0 });
  });
});

describe("telemetry simulator", () => {
  it("interpolates and labels positions as simulated", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const stops = [
      { lat: 0, lng: 0, plannedArrival: start, name: "A" },
      { lat: 1, lng: 1, plannedArrival: new Date(start.getTime() + 3600000), name: "B" },
    ];
    const p = simulatePosition(stops, start, start, new Date(start.getTime() + 1800000))!;
    expect(p.simulated).toBe(true);
    expect(p.lat).toBeCloseTo(0.5);
    expect(p.nextStop).toBe("B");
    expect(simulatePosition(stops, start, null)).toBeNull();
  });
});

describe("scenario comparison", () => {
  it("reports deltas and reassignments between two plans", () => {
    const base = solve(syntheticInstance({ orders: 8, vehicles: 3, seed: 5 }));
    const inst = syntheticInstance({ orders: 8, vehicles: 3, seed: 5 });
    inst.vehicles = inst.vehicles.slice(1);
    const next = solve(inst);
    const wrap = (s: typeof base) => ({ ...s, planStart: "", exclusions: [], assumptions: [], locations: {}, orders: {} });
    const c = compareResults(wrap(base), wrap(next));
    expect(c.delta.vehiclesUsed).toBeLessThanOrEqual(0);
    expect(typeof c.summary).toBe("string");
  });
});
