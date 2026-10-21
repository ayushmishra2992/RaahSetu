import { describe, expect, it } from "vitest";
import { DEFAULT_COST_MODEL, DEFAULT_WEIGHTS } from "../../src/optimizer/costModel";
import { haversineMatrix } from "../../src/optimizer/distance";
import { InstanceError, solve } from "../../src/optimizer/solver";
import { syntheticInstance } from "../../src/optimizer/synthetic";
import type { Instance, OptOrder, OptVehicle } from "../../src/optimizer/types";
import { validatePlan } from "../../src/optimizer/validate";

const locations = [
  { id: 1, name: "Depot", lat: 19.0, lng: 73.0 },
  { id: 2, name: "A", lat: 19.05, lng: 73.0 },
  { id: 3, name: "B", lat: 19.1, lng: 73.05 },
  { id: 4, name: "C", lat: 19.0, lng: 73.1 },
  { id: 5, name: "Far", lat: 21.0, lng: 75.0 },
];

const vehicle = (over: Partial<OptVehicle> = {}): OptVehicle => ({
  id: 1,
  label: "V1",
  capacityKg: 1000,
  fuelType: "DIESEL",
  mileageKmPerUnit: 8,
  avgSpeedKmph: 40,
  depotLocationId: 1,
  driverId: 1,
  maxShiftMinutes: 600,
  riskFactor: 0.1,
  ...over,
});

const order = (over: Partial<OptOrder> & { id: number }): OptOrder => ({
  label: `O${over.id}`,
  pickupLocationId: 2,
  dropLocationId: 3,
  weightKg: 300,
  priority: "NORMAL",
  serviceMinutes: 10,
  ...over,
});

function instance(vehicles: OptVehicle[], orders: OptOrder[], over: Partial<Instance["options"]> = {}): Instance {
  return {
    locations,
    vehicles,
    orders,
    matrix: haversineMatrix(locations),
    weights: DEFAULT_WEIGHTS,
    cost: DEFAULT_COST_MODEL,
    options: { algorithm: "GREEDY_INSERTION", seed: 1, hardTimeWindows: true, returnToDepot: true, maxIterations: 100, unservedPenalty: 20000, ...over },
  };
}

describe("OptiRoute solver", () => {
  it("serves feasible orders with pickup before drop and returns to depot", () => {
    const s = solve(instance([vehicle()], [order({ id: 1 }), order({ id: 2, pickupLocationId: 3, dropLocationId: 4 })]));
    expect(s.feasible).toBe(true);
    expect(s.unserved).toHaveLength(0);
    const stops = s.routes[0].stops;
    expect(stops[0].type).toBe("DEPOT_START");
    expect(stops.at(-1)!.type).toBe("DEPOT_END");
    for (const id of [1, 2]) {
      const p = stops.findIndex((x) => x.type === "PICKUP" && x.orderId === id);
      const d = stops.findIndex((x) => x.type === "DROP" && x.orderId === id);
      expect(p).toBeGreaterThan(0);
      expect(d).toBeGreaterThan(p);
    }
  });

  it("never exceeds vehicle capacity and reports orders that fit no vehicle", () => {
    const s = solve(instance([vehicle({ capacityKg: 500 })], [order({ id: 1, weightKg: 400 }), order({ id: 2, weightKg: 400 }), order({ id: 3, weightKg: 900 })]));
    expect(s.feasible).toBe(true);
    for (const r of s.routes) for (const st of r.stops) expect(st.loadAfterKg).toBeLessThanOrEqual(500);
    const big = s.unserved.find((u) => u.orderId === 3);
    expect(big?.reason).toMatch(/exceeds the capacity/);
  });

  it("respects hard delivery time windows and explains unserved orders", () => {
    const s = solve(instance([vehicle()], [order({ id: 1, windowEndMin: 1 })]));
    expect(s.routes).toHaveLength(0);
    expect(s.unserved[0].reason).toMatch(/time window|shift/);
    expect(s.feasible).toBe(true);
  });

  it("allows lateness only when windows are soft, and penalises it", () => {
    const s = solve(instance([vehicle()], [order({ id: 1, windowEndMin: 1 })], { hardTimeWindows: false }));
    expect(s.unserved).toHaveLength(0);
    expect(s.totals.latenessMin).toBeGreaterThan(0);
    expect(s.objective.lateness).toBeGreaterThan(0);
  });

  it("waits for the window start instead of delivering early", () => {
    const s = solve(instance([vehicle()], [order({ id: 1, windowStartMin: 300, windowEndMin: 400 })]));
    const drop = s.routes[0].stops.find((x) => x.type === "DROP")!;
    expect(drop.serviceStartMin).toBeGreaterThanOrEqual(300);
    expect(drop.serviceStartMin).toBeLessThanOrEqual(400);
  });

  it("enforces the driver shift limit", () => {
    const s = solve(instance([vehicle({ maxShiftMinutes: 30 })], [order({ id: 1, dropLocationId: 4 })]));
    expect(s.unserved).toHaveLength(1);
    expect(s.feasible).toBe(true);
  });

  it("treats unreachable legs as infeasible rather than guessing", () => {
    const inst = instance([vehicle()], [order({ id: 1, dropLocationId: 5 })]);
    const far = inst.matrix.index.get(5)!;
    for (let i = 0; i < inst.matrix.distKm.length; i++) {
      if (i === far) continue;
      inst.matrix.distKm[i][far] = Infinity;
      inst.matrix.distKm[far][i] = Infinity;
      inst.matrix.timeMin[i][far] = Infinity;
      inst.matrix.timeMin[far][i] = Infinity;
    }
    const s = solve(inst);
    expect(s.unserved[0].reason).toMatch(/No open road path/);
  });

  it("rejects invalid input instead of returning a misleading plan", () => {
    expect(() => solve(instance([], [order({ id: 1 })]))).toThrow(InstanceError);
    expect(() => solve(instance([vehicle()], [order({ id: 1, weightKg: 0 })]))).toThrow(/weight/);
    expect(() => solve(instance([vehicle()], [order({ id: 1, windowStartMin: 50, windowEndMin: 10 })]))).toThrow(/window/);
    expect(() => solve(instance([vehicle()], [order({ id: 1, pickupLocationId: 99 })]))).toThrow(/unknown locations/);
    const bad = instance([vehicle()], [order({ id: 1 })]);
    bad.weights = { ...bad.weights, time: -1 };
    expect(() => solve(bad)).toThrow(/weight time/);
  });

  it("validator flags a hand-made plan that violates capacity and precedence", () => {
    const inst = instance([vehicle({ capacityKg: 100 })], [order({ id: 1, weightKg: 300 })]);
    const violations = validatePlan(
      inst,
      [
        {
          vehicleId: 1,
          vehicleLabel: "V1",
          driverId: 1,
          metrics: {} as never,
          stops: [
            { sequence: 0, type: "DEPOT_START", orderId: null, locationId: 1, arrivalMin: 0, serviceStartMin: 0, departureMin: 0, waitMin: 0, latenessMin: 0, loadAfterKg: 0, legDistanceKm: 0 },
            { sequence: 1, type: "DROP", orderId: 1, locationId: 3, arrivalMin: 0, serviceStartMin: 0, departureMin: 0, waitMin: 0, latenessMin: 0, loadAfterKg: 0, legDistanceKm: 0 },
            { sequence: 2, type: "PICKUP", orderId: 1, locationId: 2, arrivalMin: 0, serviceStartMin: 0, departureMin: 0, waitMin: 0, latenessMin: 0, loadAfterKg: 0, legDistanceKm: 0 },
          ],
        },
      ],
      [],
    );
    const codes = violations.map((v) => v.code);
    expect(codes).toContain("PRECEDENCE");
    expect(codes).toContain("CAPACITY");
  });

  it("validator flags orders that are neither served nor reported", () => {
    const inst = instance([vehicle()], [order({ id: 1 })]);
    expect(validatePlan(inst, [], []).map((v) => v.code)).toContain("MISSING_ORDER");
  });

  it("is deterministic for the same seed and every algorithm yields a feasible plan", () => {
    for (const algorithm of ["GREEDY_INSERTION", "LOCAL_SEARCH", "SIMULATED_ANNEALING"] as const) {
      const a = solve(syntheticInstance({ orders: 15, vehicles: 4, seed: 7, algorithm, maxIterations: 150 }));
      const b = solve(syntheticInstance({ orders: 15, vehicles: 4, seed: 7, algorithm, maxIterations: 150 }));
      expect(a.feasible).toBe(true);
      expect(a.violations).toEqual([]);
      expect(a.objective.total).toBeCloseTo(b.objective.total, 6);
      expect(a.totals.servedOrders + a.unserved.length).toBe(15);
    }
  });

  it("improvement algorithms never do worse than the greedy baseline", () => {
    for (const seed of [1, 2, 3]) {
      const g = solve(syntheticInstance({ orders: 20, vehicles: 4, seed, algorithm: "GREEDY_INSERTION" }));
      const l = solve(syntheticInstance({ orders: 20, vehicles: 4, seed, algorithm: "LOCAL_SEARCH" }));
      const sa = solve(syntheticInstance({ orders: 20, vehicles: 4, seed, algorithm: "SIMULATED_ANNEALING", maxIterations: 200 }));
      expect(l.objective.total).toBeLessThanOrEqual(g.objective.total + 1e-6);
      expect(sa.objective.total).toBeLessThanOrEqual(g.objective.total + 1e-6);
    }
  });

  it("objective breakdown sums to the total", () => {
    const s = solve(syntheticInstance({ orders: 10, vehicles: 3, seed: 3 }));
    const b = s.objective;
    expect(b.time + b.distance + b.cost + b.emissions + b.lateness + b.risk + b.unservedPenalty).toBeCloseTo(b.total, 6);
  });
});
