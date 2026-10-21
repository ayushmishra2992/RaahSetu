import { prisma } from "../../config/prisma";
import type { TripStatus } from "../../generated/prisma/enums";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../../lib/errors";
import type { AuthContext } from "../../middleware/auth";
import { COMPLIANCE_BLOCKING_TYPES, buildInstance, type OptimizeRequest } from "../optiroute/optiroute.service";
import { solve } from "../../optimizer/solver";
import { createTripsFromRoutes } from "./tripFactory";

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
    if (to === "DISPATCHED") {
      const [vehicle, driver] = await Promise.all([
        tx.vehicle.findUniqueOrThrow({ where: { id: trip.vehicleId }, include: { documents: true } }),
        tx.driver.findUniqueOrThrow({ where: { id: trip.driverId } }),
      ]);
      if (vehicle.status !== "AVAILABLE") throw conflict(`Vehicle ${vehicle.registrationNumber} is ${vehicle.status}`);
      if (driver.status !== "AVAILABLE") throw conflict(`Driver ${driver.name} is ${driver.status}`);
      const expired = vehicle.documents.find((d) => (COMPLIANCE_BLOCKING_TYPES as readonly string[]).includes(d.type) && d.expiresOn && d.expiresOn < now);
      if (expired) throw conflict(`Vehicle ${expired.type} expired on ${expired.expiresOn!.toISOString().slice(0, 10)}`);
      if (driver.licenseExpiry < now) throw conflict(`Driver licence expired on ${driver.licenseExpiry.toISOString().slice(0, 10)}`);
      await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: "ON_TRIP" } });
      await tx.driver.update({ where: { id: driver.id }, data: { status: "ON_TRIP" } });
    }
    if (to === "IN_TRANSIT") {
      await tx.trip.update({ where: { id: trip.id }, data: { actualStart: now } });
      await tx.order.updateMany({ where: { id: { in: orderIds }, status: "ASSIGNED" }, data: { status: "IN_TRANSIT" } });
      await tx.tripStop.updateMany({ where: { tripId: trip.id, type: "DEPOT_START" }, data: { status: "COMPLETED", actualArrival: now } });
    }
    if (to === "COMPLETED") {
      const open = trip.stops.filter((s) => (s.type === "PICKUP" || s.type === "DROP") && (s.status === "PENDING" || s.status === "ARRIVED"));
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
    await tx.trip.update({ where: { id: trip.id }, data: { status: to } });
    await tx.tripEvent.create({ data: { tripId: trip.id, fromStatus: trip.status, toStatus: to, note: note ?? null, userId: auth.userId } });
    await tx.auditEvent.create({
      data: { companyId: auth.companyId, userId: auth.userId, action: `trip.${to.toLowerCase()}`, entityType: "Trip", entityId: trip.id, metadata: { from: trip.status } },
    });
  });
}

export type StopAction = "ARRIVE" | "COMPLETE" | "SKIP";

export async function updateStop(auth: AuthContext, tripId: number, stopId: number, action: StopAction) {
  const trip = await loadTripForAction(auth, tripId);
  if (trip.status !== "IN_TRANSIT") throw conflict("Stops can only be updated while the trip is IN_TRANSIT");
  const stop = trip.stops.find((s) => s.id === stopId);
  if (!stop) throw notFound("Stop");
  if (stop.type !== "PICKUP" && stop.type !== "DROP") throw badRequest("Depot stops are updated automatically");
  if (stop.status === "COMPLETED" || stop.status === "SKIPPED") throw conflict(`Stop is already ${stop.status}`);
  const now = new Date();
  const pickupOf = (orderId: number | null) => trip.stops.find((s) => s.type === "PICKUP" && s.orderId === orderId);
  const dropOf = (orderId: number | null) => trip.stops.find((s) => s.type === "DROP" && s.orderId === orderId);

  await prisma.$transaction(async (tx) => {
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
  });
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
