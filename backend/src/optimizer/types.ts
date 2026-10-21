/**
 * OptiRoute core types. The optimizer is pure TypeScript with no database
 * access so it can be unit-tested, benchmarked and later swapped for another
 * engine (e.g. an ApexCUDA adapter) behind the same contract.
 */

export type FuelKind = "DIESEL" | "PETROL" | "CNG" | "ELECTRIC";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type Algorithm = "GREEDY_INSERTION" | "LOCAL_SEARCH" | "SIMULATED_ANNEALING";

export interface OptLocation {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export interface OptVehicle {
  id: number;
  label: string;
  capacityKg: number;
  fuelType: FuelKind;
  mileageKmPerUnit: number;
  avgSpeedKmph: number;
  depotLocationId: number;
  driverId: number;
  driverName?: string;
  /** Maximum route duration in minutes (driver shift limit). */
  maxShiftMinutes: number;
  /** 0..1 risk score per km (vehicle age / compliance proximity). */
  riskFactor: number;
}

export interface OptOrder {
  id: number;
  label: string;
  pickupLocationId: number;
  dropLocationId: number;
  weightKg: number;
  priority: Priority;
  /** Minutes after plan start when goods are ready for pickup. */
  readyAtMin?: number | null;
  /** Delivery time window in minutes after plan start. */
  windowStartMin?: number | null;
  windowEndMin?: number | null;
  serviceMinutes: number;
}

export interface Weights {
  /** per hour of route duration */
  time: number;
  /** per km */
  distance: number;
  /** per currency unit of operating cost (fuel + driver) */
  cost: number;
  /** per kg CO2 (estimated) */
  emissions: number;
  /** per minute late (only when time windows are soft) */
  lateness: number;
  /** per risk unit (km × vehicle risk factor) */
  risk: number;
}

export interface CostModel {
  fuelPricePerUnit: Record<FuelKind, number>;
  emissionKgPerUnit: Record<FuelKind, number>;
  /** Fractional efficiency loss at full rated load (0.2 = 20% more fuel per km when full). */
  loadPenaltyAtFullLoad: number;
  driverCostPerHour: number;
}

export interface SolveOptions {
  algorithm: Algorithm;
  seed: number;
  hardTimeWindows: boolean;
  returnToDepot: boolean;
  maxIterations: number;
  /** Penalty per unserved order (multiplied by priority weight). */
  unservedPenalty: number;
}

export interface DistanceMatrix {
  /** location id -> row/col index */
  index: Map<number, number>;
  distKm: number[][];
  /** Base travel minutes from the network (before vehicle speed caps). */
  timeMin: number[][];
  source: "ROAD_GRAPH" | "HAVERSINE_ESTIMATE";
}

export interface Instance {
  locations: OptLocation[];
  vehicles: OptVehicle[];
  orders: OptOrder[];
  matrix: DistanceMatrix;
  weights: Weights;
  cost: CostModel;
  options: SolveOptions;
}

export type StopKind = "DEPOT_START" | "PICKUP" | "DROP" | "DEPOT_END";

export interface RouteStop {
  kind: "PICKUP" | "DROP";
  orderId: number;
}

export interface EvaluatedStop {
  sequence: number;
  type: StopKind;
  orderId: number | null;
  locationId: number;
  arrivalMin: number;
  serviceStartMin: number;
  departureMin: number;
  waitMin: number;
  latenessMin: number;
  loadAfterKg: number;
  legDistanceKm: number;
}

export interface RouteMetrics {
  distanceKm: number;
  durationMin: number;
  drivingMin: number;
  waitingMin: number;
  fuelUnits: number;
  fuelCost: number;
  driverCost: number;
  operatingCost: number;
  co2Kg: number;
  latenessMin: number;
  risk: number;
  maxLoadKg: number;
  utilizationPct: number;
}

export interface RouteEvaluation {
  feasible: boolean;
  reason?: string;
  stops: EvaluatedStop[];
  metrics: RouteMetrics;
  objective: number;
}

export interface Violation {
  code:
    | "CAPACITY"
    | "TIME_WINDOW"
    | "SHIFT_LIMIT"
    | "PRECEDENCE"
    | "DUPLICATE_SERVICE"
    | "MISSING_ORDER"
    | "UNREACHABLE"
    | "UNKNOWN_ENTITY";
  vehicleId?: number;
  orderId?: number;
  message: string;
}

export interface UnservedOrder {
  orderId: number;
  label: string;
  reason: string;
}

export interface ObjectiveBreakdown {
  time: number;
  distance: number;
  cost: number;
  emissions: number;
  lateness: number;
  risk: number;
  unservedPenalty: number;
  total: number;
}

export interface SolvedRoute {
  vehicleId: number;
  vehicleLabel: string;
  driverId: number;
  driverName?: string;
  stops: EvaluatedStop[];
  metrics: RouteMetrics;
}

export interface Solution {
  algorithm: Algorithm;
  seed: number;
  routes: SolvedRoute[];
  unserved: UnservedOrder[];
  totals: RouteMetrics & { servedOrders: number; vehiclesUsed: number };
  objective: ObjectiveBreakdown;
  feasible: boolean;
  violations: Violation[];
  iterations: number;
  convergence: Array<{ iteration: number; best: number }>;
  runtimeMs: number;
  distanceSource: DistanceMatrix["source"];
}
