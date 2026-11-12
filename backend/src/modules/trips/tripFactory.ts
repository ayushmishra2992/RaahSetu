import { Prisma } from "../../generated/prisma/client";
import { conflict } from "../../lib/errors";
import { docNumber, round } from "../../lib/numbering";
import { verificationToken } from "../../lib/tokens";
import type { AuthContext } from "../../middleware/auth";
import type { SolvedRoute } from "../../optimizer/types";

const ACTIVE_TRIP_STATUSES = ["PLANNED", "DISPATCHED", "IN_TRANSIT"] as const;

/**
 * Row-locks the given vehicles and drivers (SELECT … FOR UPDATE) until the
 * surrounding transaction ends, so concurrent requests that touch the same
 * vehicle or driver are serialised instead of both passing their checks.
 * Ids are locked in ascending order (vehicles, then drivers) so two
 * transactions can never wait on each other in a cycle.
 */
export async function lockFleet(tx: Prisma.TransactionClient, companyId: number, vehicleIds: number[], driverIds: number[]) {
  const v = [...new Set(vehicleIds)].sort((a, b) => a - b);
  const d = [...new Set(driverIds)].sort((a, b) => a - b);
  if (v.length) {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE "companyId" = ${companyId} AND id IN (${Prisma.join(v)}) ORDER BY id FOR UPDATE`;
  }
  if (d.length) {
    await tx.$queryRaw`SELECT id FROM "Driver" WHERE "companyId" = ${companyId} AND id IN (${Prisma.join(d)}) ORDER BY id FOR UPDATE`;
  }
}

/**
 * Persists solver routes as PLANNED trips with scheduled stops. Must be called
 * inside a transaction. It is safe under concurrency:
 *  - vehicles/drivers are locked, then re-checked for unfinished trips;
 *  - orders are claimed with a conditional PENDING → ASSIGNED update, so if
 *    another request already took any of them, this transaction rolls back.
 */
export async function createTripsFromRoutes(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  routes: SolvedRoute[],
  planStart: Date,
  opts: { runId?: number; note: string; notes?: string | null },
) {
  const vehicleIds = routes.map((r) => r.vehicleId);
  const driverIds = routes.map((r) => r.driverId);
  await lockFleet(tx, auth.companyId, vehicleIds, driverIds);

  const busy = await tx.trip.findMany({
    where: {
      companyId: auth.companyId,
      status: { in: [...ACTIVE_TRIP_STATUSES] },
      OR: [{ vehicleId: { in: vehicleIds } }, { driverId: { in: driverIds } }],
    },
    select: { tripNumber: true },
  });
  if (busy.length) {
    throw conflict(`Vehicles or drivers already have active trips (${busy.map((t) => t.tripNumber).join(", ")}). Re-run OptiRoute.`);
  }

  const orderIds = [...new Set(routes.flatMap((r) => r.stops.filter((s) => s.type === "PICKUP").map((s) => s.orderId!)))];
  const claimed = await tx.order.updateMany({
    where: { companyId: auth.companyId, id: { in: orderIds }, status: "PENDING" },
    data: { status: "ASSIGNED" },
  });
  if (claimed.count !== orderIds.length) {
    throw conflict("Some orders were assigned or changed by another request in the meantime. Reload and re-plan.");
  }

  const trips = [];
  const at = (min: number) => new Date(planStart.getTime() + min * 60000);
  for (const route of routes) {
    const first = route.stops[0];
    const last = route.stops[route.stops.length - 1];
    const trip = await tx.trip.create({
      data: {
        companyId: auth.companyId,
        tripNumber: docNumber("TRP"),
        vehicleId: route.vehicleId,
        driverId: route.driverId,
        plannedStart: at(first.departureMin),
        plannedEnd: at(last.departureMin),
        plannedDistanceKm: round(route.metrics.distanceKm, 2),
        estFuelUnits: round(route.metrics.fuelUnits, 3),
        estCost: round(route.metrics.operatingCost, 2),
        estCo2Kg: round(route.metrics.co2Kg, 3),
        optimizationRunId: opts.runId ?? null,
        verificationToken: verificationToken(),
        notes: opts.notes ?? null,
        stops: {
          create: route.stops.map((s, i) => ({
            sequence: i,
            type: s.type,
            locationId: s.locationId,
            orderId: s.orderId,
            plannedArrival: at(s.arrivalMin),
          })),
        },
        events: { create: { toStatus: "PLANNED", note: opts.note, userId: auth.userId } },
      },
    });
    trips.push(trip);
  }
  return trips;
}
