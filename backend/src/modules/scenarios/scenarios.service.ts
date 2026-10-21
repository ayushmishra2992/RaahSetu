import { z } from "zod";
import { prisma } from "../../config/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { docNumber, round } from "../../lib/numbering";
import type { AuthContext } from "../../middleware/auth";
import { getRun, runOptimization, type OptimizeRequest, type Overrides, type StoredRequest, type StoredResult, type VirtualOrder } from "../optiroute/optiroute.service";

export const ScenarioInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("VEHICLE_BREAKDOWN"), name: z.string().trim().min(2).max(120), baseRunId: z.coerce.number().int().positive(), params: z.object({ vehicleId: z.coerce.number().int().positive() }) }),
  z.object({ type: z.literal("DRIVER_UNAVAILABLE"), name: z.string().trim().min(2).max(120), baseRunId: z.coerce.number().int().positive(), params: z.object({ driverId: z.coerce.number().int().positive() }) }),
  z.object({ type: z.literal("ROAD_CLOSURE"), name: z.string().trim().min(2).max(120), baseRunId: z.coerce.number().int().positive(), params: z.object({ edgeIds: z.array(z.coerce.number().int().positive()).min(1).max(50) }) }),
  z.object({
    type: z.literal("URGENT_ORDER"),
    name: z.string().trim().min(2).max(120),
    baseRunId: z.coerce.number().int().positive(),
    params: z.object({
      customerName: z.string().trim().min(2).max(120),
      pickupLocationId: z.coerce.number().int().positive(),
      dropLocationId: z.coerce.number().int().positive(),
      weightKg: z.coerce.number().int().positive().max(100000),
      windowStart: z.coerce.date().optional().nullable(),
      windowEnd: z.coerce.date().optional().nullable(),
      serviceMinutes: z.coerce.number().int().min(0).max(600).default(20),
    }),
  }),
]);
export type ScenarioInputT = z.infer<typeof ScenarioInput>;

interface Comparison {
  base: Record<string, number>;
  scenario: Record<string, number>;
  delta: Record<string, number>;
  reassignedOrders: Array<{ orderId: number; label: string; from: string | null; to: string | null }>;
  newlyUnserved: Array<{ orderId: number; label: string; reason: string }>;
  summary: string;
}

function kpis(r: StoredResult) {
  return {
    objective: round(r.objective.total, 2),
    distanceKm: round(r.totals.distanceKm, 2),
    durationMin: round(r.totals.durationMin, 1),
    operatingCost: round(r.totals.operatingCost, 2),
    co2Kg: round(r.totals.co2Kg, 2),
    latenessMin: round(r.totals.latenessMin, 1),
    servedOrders: r.totals.servedOrders,
    unservedOrders: r.unserved.length,
    vehiclesUsed: r.totals.vehiclesUsed,
  };
}

function assignment(r: StoredResult) {
  const m = new Map<number, string>();
  for (const route of r.routes) for (const s of route.stops) if (s.type === "PICKUP" && s.orderId != null) m.set(s.orderId, route.vehicleLabel);
  return m;
}

export function compareResults(base: StoredResult, next: StoredResult): Comparison {
  const b = kpis(base);
  const n = kpis(next);
  const delta = Object.fromEntries(Object.keys(b).map((k) => [k, round((n as Record<string, number>)[k] - (b as Record<string, number>)[k], 2)] as const));
  const ba = assignment(base);
  const na = assignment(next);
  const ids = new Set([...ba.keys(), ...na.keys()]);
  const reassignedOrders = [...ids]
    .filter((id) => ba.get(id) !== na.get(id))
    .map((id) => ({ orderId: id, label: next.orders[id]?.label ?? base.orders[id]?.label ?? String(id), from: ba.get(id) ?? null, to: na.get(id) ?? null }));
  const baseUnserved = new Set(base.unserved.map((u) => u.orderId));
  const newlyUnserved = next.unserved.filter((u) => !baseUnserved.has(u.orderId));
  const parts = [
    `${delta.distanceKm >= 0 ? "+" : ""}${delta.distanceKm} km`,
    `${delta.operatingCost >= 0 ? "+" : ""}${delta.operatingCost} cost`,
    `${delta.co2Kg >= 0 ? "+" : ""}${delta.co2Kg} kg CO₂ (est.)`,
    `${reassignedOrders.length} order(s) reassigned`,
    `${newlyUnserved.length} newly unserved`,
  ];
  return { base: b, scenario: n, delta, reassignedOrders, newlyUnserved, summary: parts.join(", ") };
}

export async function evaluateScenario(auth: AuthContext, input: ScenarioInputT) {
  const baseRun = await getRun(auth.companyId, input.baseRunId);
  const baseRequest = baseRun.request as unknown as StoredRequest;
  const baseResult = baseRun.result as unknown as StoredResult;
  const prior = baseRequest.overrides;
  const overrides: Overrides = {
    mode: "snapshot",
    excludeVehicleIds: [...(prior?.excludeVehicleIds ?? [])],
    excludeDriverIds: [...(prior?.excludeDriverIds ?? [])],
    closedEdgeIds: [...(prior?.closedEdgeIds ?? [])],
    extraOrders: [...(prior?.extraOrders ?? [])],
  };
  if (input.type === "VEHICLE_BREAKDOWN") {
    if (!(await prisma.vehicle.findFirst({ where: { id: input.params.vehicleId, companyId: auth.companyId } }))) throw badRequest("Vehicle not found");
    overrides.excludeVehicleIds!.push(input.params.vehicleId);
  } else if (input.type === "DRIVER_UNAVAILABLE") {
    if (!(await prisma.driver.findFirst({ where: { id: input.params.driverId, companyId: auth.companyId } }))) throw badRequest("Driver not found");
    overrides.excludeDriverIds!.push(input.params.driverId);
  } else if (input.type === "ROAD_CLOSURE") {
    const count = await prisma.roadEdge.count({ where: { companyId: auth.companyId, id: { in: input.params.edgeIds } } });
    if (count !== new Set(input.params.edgeIds).size) throw badRequest("Road segment not found");
    overrides.closedEdgeIds!.push(...input.params.edgeIds);
  } else {
    const p = input.params;
    if (p.pickupLocationId === p.dropLocationId) throw badRequest("Pickup and drop must differ");
    const locs = await prisma.location.count({ where: { companyId: auth.companyId, id: { in: [p.pickupLocationId, p.dropLocationId] } } });
    if (locs !== 2) throw badRequest("Location not found");
    const virtual: VirtualOrder = {
      id: -(overrides.extraOrders!.length + 1),
      label: `URGENT-SIM-${overrides.extraOrders!.length + 1}`,
      customerName: p.customerName,
      pickupLocationId: p.pickupLocationId,
      dropLocationId: p.dropLocationId,
      weightKg: p.weightKg,
      priority: "URGENT",
      windowStart: p.windowStart?.toISOString() ?? null,
      windowEnd: p.windowEnd?.toISOString() ?? null,
      serviceMinutes: p.serviceMinutes,
    };
    overrides.extraOrders!.push(virtual);
  }
  const req: OptimizeRequest = {
    ...baseRequest,
    name: `Scenario: ${input.name}`,
    planStart: new Date(baseRequest.planStart),
  };
  const resultRun = await runOptimization(auth, req, overrides, baseRequest);
  const comparison = compareResults(baseResult, resultRun.result as unknown as StoredResult);
  const scenario = await prisma.scenario.create({
    data: {
      companyId: auth.companyId,
      name: input.name,
      type: input.type,
      params: input.params as unknown as Prisma.InputJsonValue,
      baseRunId: baseRun.id,
      resultRunId: resultRun.id,
      comparison: comparison as unknown as Prisma.InputJsonValue,
      createdById: auth.userId,
    },
  });
  await prisma.auditEvent.create({
    data: { companyId: auth.companyId, userId: auth.userId, action: "scenario.evaluated", entityType: "Scenario", entityId: scenario.id, metadata: { type: input.type } },
  });
  return scenario;
}

/**
 * Dispatcher approval: applies the real-world change (vehicle to maintenance,
 * driver off duty, road closed, urgent order created) and cancels not-yet-started
 * trips from the base plan so the re-optimised plan can be dispatched.
 */
export async function decideScenario(auth: AuthContext, id: number, approve: boolean, note?: string | null) {
  const scenario = await prisma.scenario.findFirst({ where: { id, companyId: auth.companyId }, include: { resultRun: true } });
  if (!scenario) throw notFound("Scenario");
  if (scenario.status !== "EVALUATED") throw conflict(`Scenario already ${scenario.status}`);
  if (!approve) {
    const s = await prisma.scenario.update({ where: { id }, data: { status: "REJECTED", decidedById: auth.userId, decidedAt: new Date(), decisionNote: note ?? null } });
    await prisma.auditEvent.create({ data: { companyId: auth.companyId, userId: auth.userId, action: "scenario.rejected", entityType: "Scenario", entityId: id } });
    return s;
  }
  if (!scenario.resultRun) throw conflict("Scenario has no evaluated plan");
  const params = scenario.params as Record<string, unknown>;

  return prisma.$transaction(async (tx) => {
    // 1. Cancel base-plan trips that have not started yet.
    const pendingTrips = await tx.trip.findMany({
      where: { companyId: auth.companyId, optimizationRunId: scenario.baseRunId, status: { in: ["PLANNED", "DISPATCHED"] } },
      include: { stops: true },
    });
    for (const t of pendingTrips) {
      const orderIds = t.stops.filter((s) => s.orderId).map((s) => s.orderId!);
      await tx.order.updateMany({ where: { id: { in: orderIds }, status: "ASSIGNED" }, data: { status: "PENDING" } });
      await tx.tripStop.updateMany({ where: { tripId: t.id, status: "PENDING" }, data: { status: "SKIPPED" } });
      if (t.status === "DISPATCHED") {
        await tx.vehicle.updateMany({ where: { id: t.vehicleId, status: "ON_TRIP" }, data: { status: "AVAILABLE" } });
        await tx.driver.updateMany({ where: { id: t.driverId, status: "ON_TRIP" }, data: { status: "AVAILABLE" } });
      }
      await tx.trip.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
      await tx.tripEvent.create({ data: { tripId: t.id, fromStatus: t.status, toStatus: "CANCELLED", note: `Replaced by approved scenario #${scenario.id}`, userId: auth.userId } });
    }

    // 2. Apply the disruption to master data.
    if (scenario.type === "VEHICLE_BREAKDOWN") {
      await tx.vehicle.updateMany({ where: { id: Number(params.vehicleId), companyId: auth.companyId, status: { not: "ON_TRIP" } }, data: { status: "MAINTENANCE" } });
    } else if (scenario.type === "DRIVER_UNAVAILABLE") {
      await tx.driver.updateMany({ where: { id: Number(params.driverId), companyId: auth.companyId, status: { not: "ON_TRIP" } }, data: { status: "OFF_DUTY" } });
    } else if (scenario.type === "ROAD_CLOSURE") {
      await tx.roadEdge.updateMany({ where: { companyId: auth.companyId, id: { in: (params.edgeIds as number[]).map(Number) } }, data: { isClosed: true } });
    }

    // 3. Materialise simulated urgent orders and rewrite the plan to use real ids.
    const runResult = scenario.resultRun!.result as unknown as StoredResult;
    const runRequest = scenario.resultRun!.request as unknown as StoredRequest;
    const idMap = new Map<number, number>();
    for (const v of runRequest.overrides?.extraOrders ?? []) {
      const order = await tx.order.create({
        data: {
          companyId: auth.companyId,
          orderNumber: docNumber("ORD"),
          customerName: v.customerName,
          pickupLocationId: v.pickupLocationId,
          dropLocationId: v.dropLocationId,
          weightKg: v.weightKg,
          priority: "URGENT",
          windowStart: v.windowStart ? new Date(v.windowStart) : null,
          windowEnd: v.windowEnd ? new Date(v.windowEnd) : null,
          serviceMinutes: v.serviceMinutes,
          notes: `Created by approved scenario #${scenario.id}`,
        },
      });
      idMap.set(v.id, order.id);
    }
    if (idMap.size) {
      const remap = (id: number | null) => (id != null && idMap.has(id) ? idMap.get(id)! : id);
      for (const r of runResult.routes) for (const s of r.stops) s.orderId = remap(s.orderId);
      for (const u of runResult.unserved) u.orderId = remap(u.orderId)!;
      runResult.orders = Object.fromEntries(Object.entries(runResult.orders).map(([k, v]) => [String(remap(Number(k))), { ...v, virtual: false }] as const));
      runRequest.resolved.orderIds = [...runRequest.resolved.orderIds, ...idMap.values()];
      runRequest.overrides = { ...runRequest.overrides!, extraOrders: [] };
      await tx.optimizationRun.update({
        where: { id: scenario.resultRun!.id },
        data: { result: runResult as unknown as Prisma.InputJsonValue, request: runRequest as unknown as Prisma.InputJsonValue },
      });
    }

    const updated = await tx.scenario.update({ where: { id }, data: { status: "APPROVED", decidedById: auth.userId, decidedAt: new Date(), decisionNote: note ?? null } });
    await tx.auditEvent.create({
      data: { companyId: auth.companyId, userId: auth.userId, action: "scenario.approved", entityType: "Scenario", entityId: id, metadata: { cancelledTrips: pendingTrips.map((t) => t.id), createdOrders: [...idMap.values()] } },
    });
    return updated;
  }, { timeout: 30_000 });
}
