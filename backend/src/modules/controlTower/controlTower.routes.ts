import { Router } from "express";
import { prisma } from "../../config/prisma";
import { authOf } from "../../lib/http";
import { round } from "../../lib/numbering";
import { requirePermission } from "../../middleware/auth";
import { getCompanySettings } from "../company/settings";
import { simulatePosition } from "../trips/telemetry";

const router = Router();

type Alert = { severity: "critical" | "warning" | "info"; type: string; message: string; link?: string };

function countBy<T extends string>(rows: Array<{ status: T; _count: { _all: number } }>) {
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all] as const)) as Record<T, number>;
}

router.get("/", requirePermission("dashboard:read"), async (req, res) => {
  const auth = authOf(req);
  const companyId = auth.companyId;
  const now = new Date();
  const settings = await getCompanySettings(companyId);
  const alertHorizon = new Date(now.getTime() + settings.documentExpiryAlertDays * 86_400_000);
  const since30 = new Date(now.getTime() - 30 * 86_400_000);

  const [vehicles, drivers, orders, trips, docs, expiringLicences, activeTrips, urgentPending, pendingScenarios, recentRuns, completed, closedRoads] = await Promise.all([
    prisma.vehicle.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
    prisma.driver.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
    prisma.trip.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
    prisma.complianceDocument.findMany({
      where: { companyId, expiresOn: { lte: alertHorizon } },
      include: { vehicle: { select: { registrationNumber: true } }, driver: { select: { name: true } } },
      orderBy: { expiresOn: "asc" },
      take: 50,
    }),
    prisma.driver.findMany({ where: { companyId, status: { not: "INACTIVE" }, licenseExpiry: { lte: alertHorizon } }, take: 20 }),
    prisma.trip.findMany({
      where: { companyId, status: { in: ["DISPATCHED", "IN_TRANSIT"] } },
      include: { vehicle: { select: { registrationNumber: true } }, driver: { select: { name: true } }, stops: { orderBy: { sequence: "asc" }, include: { location: true, order: { select: { windowEnd: true } } } } },
    }),
    prisma.order.findMany({ where: { companyId, status: "PENDING", priority: "URGENT" }, select: { id: true, orderNumber: true } }),
    prisma.scenario.count({ where: { companyId, status: "EVALUATED" } }),
    prisma.optimizationRun.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, algorithm: true, feasible: true, totalDistanceKm: true, totalCo2Kg: true, totalCost: true, unservedCount: true, createdAt: true, dispatchedAt: true },
    }),
    prisma.trip.findMany({
      where: { companyId, status: "COMPLETED", actualEnd: { gte: since30 } },
      select: { estCo2Kg: true, estCost: true, plannedDistanceKm: true, stops: { where: { type: "DROP" }, select: { actualArrival: true, status: true, order: { select: { windowEnd: true } } } } },
    }),
    prisma.roadEdge.count({ where: { companyId, isClosed: true } }),
  ]);

  const alerts: Alert[] = [];
  for (const d of docs) {
    const owner = d.vehicle?.registrationNumber ?? d.driver?.name ?? "—";
    const expired = d.expiresOn! < now;
    alerts.push({
      severity: expired ? "critical" : "warning",
      type: "DOCUMENT_EXPIRY",
      message: `${d.type} for ${owner} ${expired ? "expired" : "expires"} on ${d.expiresOn!.toISOString().slice(0, 10)}`,
      link: "/documents",
    });
  }
  for (const d of expiringLicences) {
    const expired = d.licenseExpiry < now;
    alerts.push({ severity: expired ? "critical" : "warning", type: "LICENCE_EXPIRY", message: `Driving licence of ${d.name} ${expired ? "expired" : "expires"} on ${d.licenseExpiry.toISOString().slice(0, 10)}`, link: `/drivers/${d.id}` });
  }
  if (urgentPending.length) alerts.push({ severity: "critical", type: "URGENT_UNASSIGNED", message: `${urgentPending.length} urgent order(s) not yet planned: ${urgentPending.slice(0, 5).map((o) => o.orderNumber).join(", ")}`, link: "/optiroute" });
  if (pendingScenarios) alerts.push({ severity: "info", type: "SCENARIO_PENDING", message: `${pendingScenarios} scenario(s) awaiting approval`, link: "/scenarios" });
  if (closedRoads) alerts.push({ severity: "info", type: "ROAD_CLOSED", message: `${closedRoads} road segment(s) currently closed`, link: "/locations" });

  const live = activeTrips.map((t) => {
    const pos =
      t.status === "IN_TRANSIT"
        ? simulatePosition(t.stops.map((s) => ({ lat: s.location.lat, lng: s.location.lng, plannedArrival: s.plannedArrival, name: s.location.name })), t.plannedStart, t.actualStart, now)
        : null;
    const lateStops = t.stops.filter((s) => s.type === "DROP" && s.status !== "COMPLETED" && s.status !== "SKIPPED" && s.order?.windowEnd && s.order.windowEnd < now);
    if (lateStops.length) alerts.push({ severity: "critical", type: "DELIVERY_LATE", message: `Trip ${t.tripNumber} has ${lateStops.length} delivery(ies) past their window`, link: `/trips/${t.id}` });
    if (t.status === "DISPATCHED" && t.plannedStart < new Date(now.getTime() - 30 * 60000)) {
      alerts.push({ severity: "warning", type: "TRIP_NOT_STARTED", message: `Trip ${t.tripNumber} was due to start at ${t.plannedStart.toISOString().slice(11, 16)} UTC`, link: `/trips/${t.id}` });
    }
    return {
      id: t.id,
      tripNumber: t.tripNumber,
      status: t.status,
      vehicle: t.vehicle.registrationNumber,
      driver: t.driver.name,
      stopsDone: t.stops.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length,
      stopsTotal: t.stops.length,
      position: pos,
      route: t.stops.map((s) => ({ lat: s.location.lat, lng: s.location.lng, name: s.location.name, type: s.type, status: s.status })),
    };
  });

  const vehicleCounts = countBy(vehicles);
  const activeFleet = Object.entries(vehicleCounts).filter(([k]) => k !== "INACTIVE").reduce((a, [, v]) => a + v, 0);
  const drops = completed.flatMap((t) => t.stops).filter((s) => s.status === "COMPLETED");
  const onTime = drops.filter((s) => !s.order?.windowEnd || (s.actualArrival && s.actualArrival <= s.order.windowEnd)).length;

  const severityRank = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  res.json({
    generatedAt: now,
    counts: { vehicles: vehicleCounts, drivers: countBy(drivers), orders: countBy(orders), trips: countBy(trips) },
    kpis: {
      fleetUtilizationPct: activeFleet ? round(((vehicleCounts.ON_TRIP ?? 0) / activeFleet) * 100, 1) : 0,
      onTimeDeliveryPct30d: drops.length ? round((onTime / drops.length) * 100, 1) : null,
      completedTrips30d: completed.length,
      estimatedCo2Kg30d: round(completed.reduce((a, t) => a + (t.estCo2Kg ?? 0), 0), 1),
      estimatedCost30d: round(completed.reduce((a, t) => a + (t.estCost ?? 0), 0), 0),
      plannedKm30d: round(completed.reduce((a, t) => a + (t.plannedDistanceKm ?? 0), 0), 1),
    },
    alerts,
    liveTrips: live,
    recentRuns,
    telemetryNote: "Positions are SIMULATED from the planned schedule; no GPS provider is connected.",
  });
});

export default router;
