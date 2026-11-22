import { prisma } from "../../config/prisma";
import type { TripStatus } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from "../../lib/errors";
import type { AuthContext } from "../../middleware/auth";
import { dispatchCheck, redactDispatchCheck, visibilityFor } from "../compliance/compliance.service";
import { buildInstance, type OptimizeRequest } from "../optiroute/optiroute.service";
import { solve } from "../../optimizer/solver";
import { createTripsFromRoutes, lockFleet } from "./tripFactory";

export const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  PLANNED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

const DRIVER_ALLOWED: TripStatus[] = ["IN_TRANSIT", "COMPLETED"];

export async function loadTripForAction(auth: AuthContext, tripId: number) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, companyId: auth.companyId }, include: { stops: { orderBy: { sequence: "asc" } } } });
  if (!trip) throw notFound("Trip");
  if (auth.role === "DRIVER" && trip.driverId !== auth.driverId) throw notFound("Trip");
  return trip;
}

export async function transitionTrip(auth: AuthContext, tripId: number, to: TripStatus, note?: string | null) {
  const trip = await loadTripForAction(auth, tripId);
  if (auth.role === "DRIVER" && !DRIVER_ALLOWED.includes(to)) throw forbidden("Drivers can only start or complete their trips");
  if (!canTransition(trip.status, to)) throw conflict(`Cannot move a ${trip.status} trip to ${to}`);
  const now = new Date();
  const orderIds = trip.stops.filter((s) => s.orderId != null).map((s) => s.orderId!);

  await prisma.$transaction(async (tx) => {
    // Lock order: fleet rows → trip row → orders/stops (same everywhere, avoids deadlocks).
    await lockFleet(tx, auth.companyId, [trip.vehicleId], [trip.driverId]);
    // Claim the transition atomically: only succeeds if the trip is still in the
    // status we validated above, so two concurrent requests cannot both apply.
    const claimed = await tx.trip.updateMany({ where: { id: trip.id, companyId: auth.companyId, status: trip.status }, data: { status: to } });
    if (claimed.count !== 1) throw conflict("This trip was changed by someone else. Reload and try again.");

    if (to === "DISPATCHED") {
      // Vehicle and driver rows are locked, so these reads are current until we commit.
      const [vehicle, driver] = await Promise.all([
        tx.vehicle.findUniqueOrThrow({ where: { id: trip.vehicleId } }),
        tx.driver.findUniqueOrThrow({ where: { id: trip.driverId } }),
      ]);
      if (vehicle.status !== "AVAILABLE") throw conflict(`Vehicle ${vehicle.registrationNumber} is ${vehicle.status}`);
      if (driver.status !== "AVAILABLE") throw conflict(`Driver ${driver.name} is ${driver.status}`);
      // Central compliance engine: vehicle documents, driver licence and shipment documents
      // (E-Way Bills) against the company's policy. Never bypassed.
      const check = redactDispatchCheck(await dispatchCheck(tx, auth.companyId, { vehicleId: vehicle.id, driverId: driver.id, orderIds }, now), visibilityFor(auth.role));
      if (!check.eligible) {
        throw new AppError(409, `Cannot dispatch: ${check.blockers.join("; ")}`, "COMPLIANCE_BLOCKED", { blockers: check.blockers, warnings: check.warnings });
      }
      await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: "ON_TRIP" } });
      await tx.driver.update({ where: { id: driver.id }, data: { status: "ON_TRIP" } });
    }
    if (to === "IN_TRANSIT") {
      await tx.trip.update({ where: { id: trip.id }, data: { actualStart: now } });
      await tx.order.updateMany({ where: { id: { in: orderIds }, status: "ASSIGNED" }, data: { status: "IN_TRANSIT" } });
      await tx.tripStop.updateMany({ where: { tripId: trip.id, type: "DEPOT_START" }, data: { status: "COMPLETED", actualArrival: now } });
    }
    if (to === "COMPLETED") {
      // Re-read stops inside the transaction: stop updates lock the trip row too,
      // so none can slip in between this check and the commit.
      const stops = await tx.tripStop.findMany({ where: { tripId: trip.id } });
      const open = stops.filter((s) => (s.type === "PICKUP" || s.type === "DROP") && (s.status === "PENDING" || s.status === "ARRIVED"));
      if (open.length) throw conflict(`Complete or skip all stops first (${open.length} remaining)`);
      await tx.trip.update({ where: { id: trip.id }, data: { actualEnd: now } });
      await tx.tripStop.updateMany({ where: { tripId: trip.id, type: "DEPOT_END" }, data: { status: "COMPLETED", actualArrival: now } });
    }
    if (to === "CANCELLED") {
      await tx.order.updateMany({ where: { id: { in: orderIds }, status: { in: ["ASSIGNED", "IN_TRANSIT"] } }, data: { status: "PENDING" } });
      await tx.tripStop.updateMany({ where: { tripId: trip.id, status: { in: ["PENDING", "ARRIVED"] } }, data: { status: "SKIPPED" } });
    }
    if ((to === "COMPLETED" || to === "CANCELLED") && trip.status !== "PLANNED") {
      await tx.vehicle.updateMany({ where: { id: trip.vehicleId, status: "ON_TRIP" }, data: { status: "AVAILABLE" } });
      await tx.driver.updateMany({ where: { id: trip.driverId, status: "ON_TRIP" }, data: { status: "AVAILABLE" } });
    }
    await tx.tripEvent.create({ data: { tripId: trip.id, fromStatus: trip.status, toStatus: to, note: note ?? null, userId: auth.userId } });
    await tx.auditEvent.create({
      data: { companyId: auth.companyId, userId: auth.userId, action: `trip.${to.toLowerCase()}`, entityType: "Trip", entityId: trip.id, metadata: { from: trip.status } },
    });
  });
}

export type StopAction = "ARRIVE" | "COMPLETE" | "SKIP";

export async function updateStop(auth: AuthContext, tripId: number, stopId: number, action: StopAction) {
  // Outside the transaction: 404 for other tenants and for drivers' foreign trips.
  const trip = await loadTripForAction(auth, tripId);
  await prisma.$transaction((tx) => applyStopAction(tx, auth, trip.id, stopId, action));
}

/**
 * Stop transition inside the CALLER's transaction (so proof of delivery can record
 * the stop outcome and the POD atomically). The caller must already have checked
 * that `auth` may act on this trip (loadTripForAction).
 */
export async function applyStopAction(tx: Prisma.TransactionClient, auth: AuthContext, tripId: number, stopId: number, action: StopAction) {
  const trip = { id: tripId };
  const now = new Date();
  {
    // Lock the trip row so stop updates and trip transitions on this trip run one
    // at a time, then validate against data read under that lock.
    const [locked] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "Trip" WHERE id = ${trip.id} AND "companyId" = ${auth.companyId} FOR UPDATE`;
    if (!locked) throw notFound("Trip");
    if (locked.status !== "IN_TRANSIT") throw conflict("Stops can only be updated while the trip is IN_TRANSIT");
    const stops = await tx.tripStop.findMany({ where: { tripId: trip.id }, orderBy: { sequence: "asc" } });
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) throw notFound("Stop");
    if (stop.type !== "PICKUP" && stop.type !== "DROP") throw badRequest("Depot stops are updated automatically");
    if (stop.status === "COMPLETED" || stop.status === "SKIPPED") throw conflict(`Stop is already ${stop.status}`);
    const pickupOf = (orderId: number | null) => stops.find((s) => s.type === "PICKUP" && s.orderId === orderId);
    const dropOf = (orderId: number | null) => stops.find((s) => s.type === "DROP" && s.orderId === orderId);

    if (action === "ARRIVE") {
      if (stop.status !== "PENDING") throw conflict("Already arrived");
      await tx.tripStop.update({ where: { id: stop.id }, data: { status: "ARRIVED", actualArrival: now } });
    } else if (action === "COMPLETE") {
      if (stop.type === "DROP" && pickupOf(stop.orderId)?.status !== "COMPLETED") {
        throw conflict("Complete the pickup for this order before its delivery");
      }
      await tx.tripStop.update({ where: { id: stop.id }, data: { status: "COMPLETED", actualArrival: stop.actualArrival ?? now } });
      if (stop.type === "DROP" && stop.orderId) await tx.order.update({ where: { id: stop.orderId }, data: { status: "DELIVERED" } });
    } else {
      await tx.tripStop.update({ where: { id: stop.id }, data: { status: "SKIPPED" } });
      if (stop.type === "PICKUP") {
        const drop = dropOf(stop.orderId);
        if (drop) await tx.tripStop.update({ where: { id: drop.id }, data: { status: "SKIPPED" } });
      }
      // Undelivered goods go back to the planning pool.
      if (stop.orderId) await tx.order.update({ where: { id: stop.orderId }, data: { status: "PENDING" } });
    }
    await tx.auditEvent.create({
      data: { companyId: auth.companyId, userId: auth.userId, action: `trip.stop_${action.toLowerCase()}`, entityType: "Trip", entityId: trip.id, metadata: { stopId, orderId: stop.orderId } },
    });
    return stop;
  }
}

/** Manual trip: dispatcher picks vehicle, driver and orders; stops are sequenced and validated by OptiRoute. */
export async function createManualTrip(
  auth: AuthContext,
  input: { vehicleId: number; driverId: number; orderIds: number[]; plannedStart?: Date; notes?: string | null },
) {
  const req: OptimizeRequest = {
    algorithm: "LOCAL_SEARCH",
    seed: 1,
    orderIds: input.orderIds,
    vehicleIds: [input.vehicleId],
    assignments: [{ vehicleId: input.vehicleId, driverId: input.driverId }],
    hardTimeWindows: true,
    returnToDepot: true,
    maxIterations: 200,
    planStart: input.plannedStart,
    useRoadNetwork: true,
    unservedPenalty: 20000,
  };
  const { instance, meta } = await buildInstance(auth.companyId, req);
  const vehicle = instance.vehicles[0];
  if (!vehicle || vehicle.id !== input.vehicleId) {
    const reason = meta.exclusions.find((e) => e.kind === "VEHICLE" && e.id === input.vehicleId)?.reason ?? "Vehicle is not eligible";
    throw unprocessable(`Vehicle cannot take this trip: ${reason}`, { exclusions: meta.exclusions });
  }
  if (vehicle.driverId !== input.driverId) {
    const reason = meta.exclusions.find((e) => e.kind === "DRIVER" && e.id === input.driverId)?.reason ?? "Driver is not eligible";
    throw unprocessable(`Driver cannot take this trip: ${reason}`, { exclusions: meta.exclusions });
  }
  const solution = solve(instance);
  if (solution.unserved.length || !solution.feasible) {
    throw unprocessable("These orders do not fit on one feasible trip for this vehicle", {
      unserved: solution.unserved,
      violations: solution.violations,
    });
  }
  const [trip] = await prisma.$transaction((tx) =>
    createTripsFromRoutes(tx, auth, solution.routes, meta.planStart, { note: "Created manually (stops sequenced by OptiRoute)", notes: input.notes }),
  );
  await prisma.auditEvent.create({
    data: { companyId: auth.companyId, userId: auth.userId, action: "trip.created", entityType: "Trip", entityId: trip.id, metadata: { orders: input.orderIds } },
  });
  return trip;
}
