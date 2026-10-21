import { DEFAULT_COST_MODEL, DEFAULT_WEIGHTS } from "./costModel";
import { haversineMatrix } from "./distance";
import { createRng } from "./rng";
import type { Algorithm, Instance, OptOrder, OptVehicle } from "./types";

/**
 * Reproducible SYNTHETIC instance generator for tests and benchmarks.
 * Locations are random points in a ~45 km box around Mumbai; nothing here is real demand data.
 */
export function syntheticInstance(opts: { orders: number; vehicles: number; seed: number; algorithm?: Algorithm; maxIterations?: number; hardTimeWindows?: boolean }): Instance {
  const rng = createRng(opts.seed);
  const nLoc = Math.max(6, Math.ceil(opts.orders * 1.2) + 2);
  const locations = Array.from({ length: nLoc }, (_, i) => ({ id: i + 1, name: `L${i + 1}`, lat: 18.95 + rng.next() * 0.4, lng: 72.82 + rng.next() * 0.45 }));
  const vehicles: OptVehicle[] = Array.from({ length: opts.vehicles }, (_, i) => ({
    id: i + 1,
    label: `V${i + 1}`,
    capacityKg: [1500, 3000, 5000, 9000][i % 4],
    fuelType: (["DIESEL", "DIESEL", "CNG", "ELECTRIC"] as const)[i % 4],
    mileageKmPerUnit: [12, 8, 13, 6.5][i % 4],
    avgSpeedKmph: 35,
    depotLocationId: 1,
    driverId: i + 1,
    maxShiftMinutes: 600,
    riskFactor: 0.05 + (i % 3) * 0.05,
  }));
  const pickups = Math.max(1, Math.floor(nLoc / 5));
  const orders: OptOrder[] = Array.from({ length: opts.orders }, (_, i) => {
    const pickup = 2 + rng.int(pickups);
    let drop = 2 + pickups + rng.int(nLoc - pickups - 1);
    if (drop === pickup) drop = nLoc;
    const ws = rng.next() < 0.6 ? 60 + rng.int(180) : null;
    return {
      id: i + 1,
      label: `O${i + 1}`,
      pickupLocationId: pickup,
      dropLocationId: drop,
      weightKg: 100 + rng.int(1400),
      priority: (["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"] as const)[rng.int(5)],
      readyAtMin: null,
      windowStartMin: ws,
      windowEndMin: ws === null ? null : ws + 180 + rng.int(240),
      serviceMinutes: 15,
    };
  });
  return {
    locations,
    vehicles,
    orders,
    matrix: haversineMatrix(locations),
    weights: DEFAULT_WEIGHTS,
    cost: DEFAULT_COST_MODEL,
    options: {
      algorithm: opts.algorithm ?? "GREEDY_INSERTION",
      seed: opts.seed,
      hardTimeWindows: opts.hardTimeWindows ?? true,
      returnToDepot: true,
      maxIterations: opts.maxIterations ?? 300,
      unservedPenalty: 20000,
    },
  };
}
