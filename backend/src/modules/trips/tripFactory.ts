import type { Prisma } from "../../generated/prisma/client";
import { docNumber, round } from "../../lib/numbering";
import { verificationToken } from "../../lib/tokens";
import type { AuthContext } from "../../middleware/auth";
import type { SolvedRoute } from "../../optimizer/types";

/** Persists solver routes as PLANNED trips with scheduled stops. Call inside a transaction. */
export async function createTripsFromRoutes(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  routes: SolvedRoute[],
  planStart: Date,
  opts: { runId?: number; note: string; notes?: string | null },
) {
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
  const orderIds = routes.flatMap((r) => r.stops.filter((s) => s.type === "PICKUP").map((s) => s.orderId!));
  await tx.order.updateMany({ where: { companyId: auth.companyId, id: { in: orderIds } }, data: { status: "ASSIGNED" } });
  return trips;
}
