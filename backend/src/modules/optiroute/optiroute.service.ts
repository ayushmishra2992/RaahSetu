import { z } from "zod";
import { prisma } from "../../config/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { badRequest, conflict, notFound, unprocessable } from "../../lib/errors";
import { round } from "../../lib/numbering";
import type { AuthContext } from "../../middleware/auth";
import {
  ACCESS_CIRCUITY_FACTOR,
  ACCESS_SPEED_KMPH,
  graphMatrix,
  HAVERSINE_CIRCUITY_FACTOR,
  HAVERSINE_SPEED_KMPH,
  haversineMatrix,
} from "../../optimizer/distance";
import { InstanceError, solve } from "../../optimizer/solver";
import type { Instance, OptLocation, OptOrder, OptVehicle, Solution } from "../../optimizer/types";
import { createTripsFromRoutes, lockFleet } from "../trips/tripFactory";
import { costModelFrom, getCompanySettings, weightsFrom, WeightsSchema } from "../company/settings";
import { redactCompliance, type ComplianceVisibility } from "../compliance/compliance";
import { driverCompliance, vehicleCompliance } from "../compliance/compliance.service";

/**
 * Exclusion reasons are saved in optimisation plans and returned in manual-trip
 * 422s, both readable by roles without kyc:read: never include KYC detail there.
 */
const PLAN_VISIBILITY: ComplianceVisibility = { kyc: false, documents: true };

export const OptimizeRequestSchema = z.object({
  name: z.string().trim().max(120).optional(),
  algorithm: z.enum(["GREEDY_INSERTION", "LOCAL_SEARCH", "SIMULATED_ANNEALING"]).default("LOCAL_SEARCH"),
  seed: z.coerce.number().int().min(0).max(2_147_483_647).default(42),
  orderIds: z.array(z.coerce.number().int().positive()).max(300).optional(),
  vehicleIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
  assignments: z.array(z.object({ vehicleId: z.coerce.number().int().positive(), driverId: z.coerce.number().int().positive() })).optional(),
  weights: WeightsSchema.partial().optional(),
  hardTimeWindows: z.boolean().default(true),
  returnToDepot: z.boolean().default(true),
  maxIterations: z.coerce.number().int().min(0).max(5000).default(400),
  planStart: z.coerce.date().optional(),
  useRoadNetwork: z.boolean().default(true),
  unservedPenalty: z.coerce.number().positive().max(1e9).default(20000),
});
export type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

export interface VirtualOrder {
  id: number; // negative, never persisted
  label: string;
  customerName: string;
  pickupLocationId: number;
  dropLocationId: number;
  weightKg: number;
  priority: OptOrder["priority"];
  windowStart?: string | null;
  windowEnd?: string | null;
  serviceMinutes: number;
}

export interface Overrides {
  /** live: use current statuses. snapshot: re-plan exactly the base run's orders/vehicles (what-if). */
  mode: "live" | "snapshot";
  excludeVehicleIds?: number[];
  excludeDriverIds?: number[];
  closedEdgeIds?: number[];
  extraOrders?: VirtualOrder[];
}

export interface Exclusion {
  kind: "VEHICLE" | "DRIVER" | "ORDER";
  id: number;
  label: string;
  reason: string;
}

export interface StoredRequest extends Omit<OptimizeRequest, "planStart"> {
  planStart: string;
  resolved: { orderIds: number[]; assignments: Array<{ vehicleId: number; driverId: number }> };
  overrides?: Overrides;
}

export interface StoredResult extends Solution {
  planStart: string;
  exclusions: Exclusion[];
  assumptions: string[];
  locations: Record<number, { name: string; lat: number; lng: number }>;
  orders: Record<number, { label: string; customerName: string; weightKg: number; priority: string; virtual?: boolean }>;
}

const minutesFrom = (planStart: Date, d: Date | null | undefined) =>
  d ? Math.round((d.getTime() - planStart.getTime()) / 60000) : null;

function defaultPlanStart(): Date {
  const d = new Date(Date.now() + 15 * 60000);
  d.setSeconds(0, 0);
  return d;
}

function vehicleRisk(year: number | null, expiringSoon: boolean, now: Date) {
  const age = year ? Math.max(0, now.getFullYear() - year) : 5;
  return Math.min(1, 0.05 + Math.min(0.2, age * 0.01) + (expiringSoon ? 0.1 : 0));
}

/** Loads company data and builds a solver instance. Throws 4xx errors for unusable input. */
export async function buildInstance(companyId: number, req: OptimizeRequest, overrides: Overrides = { mode: "live" }, base?: StoredRequest) {
  const settings = await getCompanySettings(companyId);
  const planStart = req.planStart ?? defaultPlanStart();
  const exclusions: Exclusion[] = [];
  const excludedVehicles = new Set(overrides.excludeVehicleIds ?? []);
  const excludedDrivers = new Set(overrides.excludeDriverIds ?? []);

  // ── Orders
  let orderIds = overrides.mode === "snapshot" && base ? base.resolved.orderIds : req.orderIds;
  const orders = await prisma.order.findMany({
    where: {
      companyId,
      ...(orderIds ? { id: { in: orderIds } } : { status: "PENDING" }),
    },
    orderBy: { id: "asc" },
    take: 300,
  });
  if (orderIds) {
    const found = new Set(orders.map((o) => o.id));
    const missing = orderIds.filter((id) => !found.has(id));
    if (missing.length) throw badRequest(`Orders not found: ${missing.join(", ")}`);
    if (overrides.mode === "live") {
      const notPending = orders.filter((o) => o.status !== "PENDING");
      if (notPending.length) throw badRequest(`Only PENDING orders can be planned: ${notPending.map((o) => o.orderNumber).join(", ")}`);
    }
  }
  orderIds = orders.map((o) => o.id);
  const optOrders: OptOrder[] = orders.map((o) => ({
    id: o.id,
    label: o.orderNumber,
    pickupLocationId: o.pickupLocationId,
    dropLocationId: o.dropLocationId,
    weightKg: o.weightKg,
    priority: o.priority,
    readyAtMin: minutesFrom(planStart, o.readyAt),
    windowStartMin: minutesFrom(planStart, o.windowStart),
    windowEndMin: minutesFrom(planStart, o.windowEnd),
    serviceMinutes: o.serviceMinutes,
  }));
  for (const v of overrides.extraOrders ?? []) {
    optOrders.push({
      id: v.id,
      label: v.label,
      pickupLocationId: v.pickupLocationId,
      dropLocationId: v.dropLocationId,
      weightKg: v.weightKg,
      priority: v.priority,
      readyAtMin: null,
      windowStartMin: v.windowStart ? minutesFrom(planStart, new Date(v.windowStart)) : null,
      windowEndMin: v.windowEnd ? minutesFrom(planStart, new Date(v.windowEnd)) : null,
      serviceMinutes: v.serviceMinutes,
    });
  }
  if (optOrders.length === 0) throw unprocessable("There are no pending orders to plan. Create orders first.");

  // ── Vehicles
  const vehicleIds = overrides.mode === "snapshot" && base ? base.resolved.assignments.map((a) => a.vehicleId) : req.vehicleIds;
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId, ...(vehicleIds ? { id: { in: vehicleIds } } : { status: "AVAILABLE" }) },
    include: { documents: true, depotLocation: true },
    orderBy: [{ capacityKg: "desc" }, { id: "asc" }],
  });
  if (vehicleIds) {
    const found = new Set(vehicles.map((v) => v.id));
    const missing = vehicleIds.filter((id) => !found.has(id));
    if (missing.length) throw badRequest(`Vehicles not found: ${missing.join(", ")}`);
  }
  const drivers = await prisma.driver.findMany({ where: { companyId }, include: { documents: true }, orderBy: { id: "asc" } });
  // In live mode a vehicle/driver with an unfinished trip is not free, even before dispatch.
  const activeTrips =
    overrides.mode === "live"
      ? await prisma.trip.findMany({
          where: { companyId, status: { in: ["PLANNED", "DISPATCHED", "IN_TRANSIT"] } },
          select: { vehicleId: true, driverId: true, tripNumber: true },
        })
      : [];
  const busyVehicle = new Map(activeTrips.map((t) => [t.vehicleId, t.tripNumber]));
  const busyDriver = new Map(activeTrips.map((t) => [t.driverId, t.tripNumber]));
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const alertMs = settings.documentExpiryAlertDays * 86_400_000;

  const eligibleVehicles: typeof vehicles = [];
  for (const v of vehicles) {
    const label = v.registrationNumber;
    if (excludedVehicles.has(v.id)) {
      exclusions.push({ kind: "VEHICLE", id: v.id, label, reason: "Excluded by scenario (unavailable/breakdown)" });
      continue;
    }
    if (overrides.mode === "live" && v.status !== "AVAILABLE") {
      exclusions.push({ kind: "VEHICLE", id: v.id, label, reason: `Status is ${v.status}` });
      continue;
    }
    if (!v.depotLocation) {
      exclusions.push({ kind: "VEHICLE", id: v.id, label, reason: "No depot location assigned" });
      continue;
    }
    // Central compliance engine: required documents valid at plan start, per company policy.
    // The reason is stored in the plan and shown to every role that can read plans, so
    // it is always KYC-redacted (eligibility itself is computed from the full result).
    const compliance = redactCompliance(vehicleCompliance(v, settings, planStart), PLAN_VISIBILITY);
    if (!compliance.eligible) {
      exclusions.push({ kind: "VEHICLE", id: v.id, label, reason: compliance.blockers.join("; ") });
      continue;
    }
    if (busyVehicle.has(v.id)) {
      exclusions.push({ kind: "VEHICLE", id: v.id, label, reason: `Already on trip ${busyVehicle.get(v.id)}` });
      continue;
    }
    eligibleVehicles.push(v);
  }

  // ── Driver pairing
  const driverOk = (id: number) => {
    const d = driverById.get(id);
    if (!d) return "Driver not found";
    if (excludedDrivers.has(id)) return "Excluded by scenario (driver unavailable)";
    if (overrides.mode === "live" && d.status !== "AVAILABLE") return `Driver status is ${d.status}`;
    if (busyDriver.has(id)) return `Already on trip ${busyDriver.get(id)}`;
    if (d.status === "INACTIVE") return "Driver is inactive";
    const compliance = redactCompliance(driverCompliance(d, settings, planStart), PLAN_VISIBILITY);
    if (!compliance.eligible) return compliance.blockers.join("; ");
    return null;
  };
  const requested = new Map(
    (overrides.mode === "snapshot" && base ? base.resolved.assignments : req.assignments ?? []).map((a) => [a.vehicleId, a.driverId]),
  );
  for (const [, driverId] of requested) {
    if (!driverById.has(driverId)) throw badRequest(`Driver ${driverId} not found`);
  }
  const usedDrivers = new Set<number>();
  const reportedDrivers = new Set<number>();
  // Spare drivers for vehicles without a (valid) requested driver: must be AVAILABLE right now.
  const requestedDriverIds = new Set(requested.values());
  const pool = drivers.filter((d) => d.status === "AVAILABLE" && !requestedDriverIds.has(d.id) && driverOk(d.id) === null);
  const optVehicles: OptVehicle[] = [];
  for (const v of eligibleVehicles) {
    let driverId = requested.get(v.id);
    if (driverId !== undefined) {
      const problem = driverOk(driverId);
      if (problem || usedDrivers.has(driverId)) {
        if (!reportedDrivers.has(driverId)) {
          exclusions.push({ kind: "DRIVER", id: driverId, label: driverById.get(driverId)!.name, reason: problem ?? "Assigned to two vehicles" });
          reportedDrivers.add(driverId);
        }
        driverId = undefined;
      }
    }
    if (driverId === undefined) driverId = pool.find((d) => !usedDrivers.has(d.id))?.id;
    if (driverId === undefined) {
      exclusions.push({ kind: "VEHICLE", id: v.id, label: v.registrationNumber, reason: "No eligible driver available" });
      continue;
    }
    usedDrivers.add(driverId);
    const driver = driverById.get(driverId)!;
    const expiringSoon = v.documents.some((d) => d.expiresOn && d.expiresOn.getTime() - planStart.getTime() < alertMs);
    optVehicles.push({
      id: v.id,
      label: v.registrationNumber,
      capacityKg: v.capacityKg,
      fuelType: v.fuelType,
      mileageKmPerUnit: v.mileageKmPerUnit,
      avgSpeedKmph: v.avgSpeedKmph,
      depotLocationId: v.depotLocationId!,
      driverId,
      driverName: driver.name,
      maxShiftMinutes: Math.round(driver.maxShiftHours * 60),
      riskFactor: round(vehicleRisk(v.year, expiringSoon, planStart), 3),
    });
  }
  if (optVehicles.length === 0) {
    throw unprocessable("No eligible vehicle with an available driver. Check vehicle status, depot, compliance documents and driver availability.", { exclusions });
  }

  // ── Locations & distance matrix
  const locIds = new Set<number>();
  for (const v of optVehicles) locIds.add(v.depotLocationId);
  for (const o of optOrders) {
    locIds.add(o.pickupLocationId);
    locIds.add(o.dropLocationId);
  }
  const locations = await prisma.location.findMany({ where: { companyId, id: { in: [...locIds] } } });
  if (locations.length !== locIds.size) throw badRequest("Some order/depot locations do not belong to your company");
  const optLocations: Array<OptLocation & { roadNodeId: number | null }> = locations.map((l) => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng, roadNodeId: l.roadNodeId }));

  let matrix;
  const assumptions: string[] = [];
  const nodeCount = req.useRoadNetwork ? await prisma.roadNode.count({ where: { companyId } }) : 0;
  if (nodeCount > 0) {
    const [nodes, edges] = await Promise.all([prisma.roadNode.findMany({ where: { companyId } }), prisma.roadEdge.findMany({ where: { companyId } })]);
    matrix = graphMatrix({ locations: optLocations, nodes, edges, closedEdgeIds: overrides.closedEdgeIds });
    assumptions.push(
      "Distances use shortest paths (Dijkstra) over the company road network; closed roads are excluded.",
      `Location-to-road access legs: straight line × ${ACCESS_CIRCUITY_FACTOR} at ${ACCESS_SPEED_KMPH} km/h.`,
    );
  } else {
    matrix = haversineMatrix(optLocations);
    assumptions.push(`No road network configured: distances are straight-line × ${HAVERSINE_CIRCUITY_FACTOR} at ${HAVERSINE_SPEED_KMPH} km/h (estimate).`);
  }
  assumptions.push(
    "Travel time per leg is the slower of network time and the vehicle's average speed.",
    `Fuel use rises linearly with load, up to +${Math.round(settings.loadPenaltyAtFullLoad * 100)}% at full capacity.`,
    "Fuel, cost and CO₂ figures are planning estimates from configured factors, not measurements.",
    "Risk = km × vehicle risk factor (age and documents nearing expiry).",
  );

  const instance: Instance = {
    locations: optLocations,
    vehicles: optVehicles,
    orders: optOrders,
    matrix,
    weights: weightsFrom(settings, req.weights),
    cost: costModelFrom(settings),
    options: {
      algorithm: req.algorithm,
      seed: req.seed,
      hardTimeWindows: req.hardTimeWindows,
      returnToDepot: req.returnToDepot,
      maxIterations: req.maxIterations,
      unservedPenalty: req.unservedPenalty,
    },
  };

  const stored: StoredRequest = {
    ...req,
    planStart: planStart.toISOString(),
    resolved: { orderIds, assignments: optVehicles.map((v) => ({ vehicleId: v.id, driverId: v.driverId })) },
    overrides: overrides.mode === "live" && !overrides.extraOrders?.length ? undefined : overrides,
  };
  const meta = {
    planStart,
    exclusions,
    assumptions,
    locations: Object.fromEntries(locations.map((l) => [l.id, { name: l.name, lat: l.lat, lng: l.lng }] as const)),
    orders: Object.fromEntries([
      ...orders.map((o) => [o.id, { label: o.orderNumber, customerName: o.customerName, weightKg: o.weightKg, priority: o.priority as string, virtual: false }] as const),
      ...(overrides.extraOrders ?? []).map((o) => [o.id, { label: o.label, customerName: o.customerName, weightKg: o.weightKg, priority: o.priority as string, virtual: true }] as const),
    ]),
  };
  return { instance, stored, meta };
}

/** Builds, solves and persists an optimization run. */
export async function runOptimization(auth: AuthContext, req: OptimizeRequest, overrides?: Overrides, base?: StoredRequest) {
  const { instance, stored, meta } = await buildInstance(auth.companyId, req, overrides, base);
  let solution: Solution;
  try {
    solution = solve(instance);
  } catch (e) {
    if (e instanceof InstanceError) throw unprocessable(e.message, e.problems);
    throw e;
  }
  const result: StoredResult = {
    ...solution,
    planStart: meta.planStart.toISOString(),
    exclusions: meta.exclusions,
    assumptions: meta.assumptions,
    locations: meta.locations,
    orders: meta.orders,
  };
  const run = await prisma.optimizationRun.create({
    data: {
      companyId: auth.companyId,
      createdById: auth.userId,
      name: req.name || `${req.algorithm.replace(/_/g, " ").toLowerCase()} plan`,
      algorithm: req.algorithm,
      status: "COMPLETED",
      seed: req.seed,
      request: stored as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
      objective: round(solution.objective.total, 4),
      feasible: solution.feasible,
      totalDistanceKm: round(solution.totals.distanceKm, 3),
      totalCo2Kg: round(solution.totals.co2Kg, 3),
      totalCost: round(solution.totals.operatingCost, 2),
      unservedCount: solution.unserved.length,
      runtimeMs: solution.runtimeMs,
      distanceSource: solution.distanceSource,
    },
  });
  await prisma.auditEvent.create({
    data: {
      companyId: auth.companyId,
      userId: auth.userId,
      action: "optimization.run",
      entityType: "OptimizationRun",
      entityId: run.id,
      metadata: { algorithm: run.algorithm, feasible: run.feasible, unserved: run.unservedCount, scenario: !!overrides && overrides.mode === "snapshot" },
    },
  });
  return run;
}

export async function getRun(companyId: number, id: number) {
  const run = await prisma.optimizationRun.findFirst({
    where: { id, companyId },
    include: { trips: { select: { id: true, tripNumber: true, status: true, vehicleId: true } } },
  });
  if (!run) throw notFound("Optimization run");
  return run;
}

/** Converts a feasible plan into PLANNED trips (one per vehicle route). */
export async function dispatchRun(auth: AuthContext, runId: number) {
  const run = await getRun(auth.companyId, runId);
  if (run.dispatchedAt) throw conflict("This plan has already been converted into trips");
  if (!run.feasible) throw conflict("Infeasible plans cannot be dispatched");
  const result = run.result as unknown as StoredResult;
  if (result.routes.length === 0) throw conflict("This plan has no routes to dispatch");
  const orderIds = result.routes.flatMap((r) => r.stops.filter((s) => s.type === "PICKUP").map((s) => s.orderId!));
  if (orderIds.some((id) => id < 0)) throw conflict("Plan contains simulated orders; approve the scenario first");
  const planStart = new Date(result.planStart);

  return prisma.$transaction(async (tx) => {
    // Lock order everywhere: fleet rows → trip/run rows → orders/stops (avoids deadlocks).
    // Locking the plan's vehicles/drivers first means the checks below cannot be
    // invalidated by another dispatch before we commit.
    await lockFleet(tx, auth.companyId, result.routes.map((r) => r.vehicleId), result.routes.map((r) => r.driverId));
    // Claim the run: a concurrent dispatch of the same run blocks on this row,
    // then matches 0 rows once we commit, so trips are created only once.
    const claimed = await tx.optimizationRun.updateMany({
      where: { id: run.id, companyId: auth.companyId, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    });
    if (claimed.count !== 1) throw conflict("This plan has already been converted into trips");
    const orders = await tx.order.findMany({ where: { companyId: auth.companyId, id: { in: orderIds } } });
    const notPending = orders.filter((o) => o.status !== "PENDING");
    if (orders.length !== orderIds.length || notPending.length) {
      throw conflict(`Plan is stale: some orders are no longer pending (${notPending.map((o) => o.orderNumber).join(", ")}). Re-run OptiRoute.`);
    }
    const vehicleIds = result.routes.map((r) => r.vehicleId);
    const driverIds = result.routes.map((r) => r.driverId);
    const busyVehicles = await tx.vehicle.findMany({ where: { companyId: auth.companyId, id: { in: vehicleIds }, status: { not: "AVAILABLE" } } });
    const busyDrivers = await tx.driver.findMany({ where: { companyId: auth.companyId, id: { in: driverIds }, status: { not: "AVAILABLE" } } });
    const activeTrips = await tx.trip.findMany({
      where: { companyId: auth.companyId, status: { in: ["PLANNED", "DISPATCHED", "IN_TRANSIT"] }, OR: [{ vehicleId: { in: vehicleIds } }, { driverId: { in: driverIds } }] },
      select: { tripNumber: true },
    });
    if (activeTrips.length) {
      throw conflict(`Plan is stale: vehicles or drivers already have active trips (${activeTrips.map((t) => t.tripNumber).join(", ")}). Re-run OptiRoute.`);
    }
    if (busyVehicles.length || busyDrivers.length) {
      throw conflict(
        `Plan is stale: ${[...busyVehicles.map((v) => v.registrationNumber), ...busyDrivers.map((d) => d.name)].join(", ")} no longer available. Re-run OptiRoute.`,
      );
    }
    const trips = await createTripsFromRoutes(tx, auth, result.routes, planStart, { runId: run.id, note: `Created from OptiRoute run #${run.id}` });
    await tx.auditEvent.create({
      data: { companyId: auth.companyId, userId: auth.userId, action: "optimization.dispatched", entityType: "OptimizationRun", entityId: run.id, metadata: { trips: trips.map((t) => t.id) } },
    });
    return trips;
  }, { timeout: 30_000 });
}
