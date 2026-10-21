import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { round } from "../../lib/numbering";
import { parseBody, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { estimateTrip, FUEL_UNIT } from "../../optimizer/costModel";
import { costModelFrom, getCompanySettings } from "../company/settings";
import { observedEfficiency } from "./greenfleet.service";

const router = Router();
router.use(requirePermission("greenfleet:read"));

const EstimateBody = z.object({
  distanceKm: z.coerce.number().positive().max(5000),
  loadKg: z.coerce.number().nonnegative().max(100000).default(0),
  durationMin: z.coerce.number().positive().max(10000).optional(),
  vehicleIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
});

/** Compares estimated fuel, cost and CO₂ of the same job across vehicles. */
router.post("/estimate", async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(EstimateBody, req);
  const settings = await getCompanySettings(auth.companyId);
  const cost = costModelFrom(settings);
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId: auth.companyId, status: { not: "INACTIVE" }, ...(body.vehicleIds ? { id: { in: body.vehicleIds } } : {}) },
    orderBy: { registrationNumber: "asc" },
  });
  const rows = vehicles.map((v) => {
    const durationMin = body.durationMin ?? (body.distanceKm / v.avgSpeedKmph) * 60;
    const canCarry = v.capacityKg >= body.loadKg;
    const e = estimateTrip({ distanceKm: body.distanceKm, durationMin, averageLoadKg: Math.min(body.loadKg, v.capacityKg), capacityKg: v.capacityKg, fuelType: v.fuelType, mileageKmPerUnit: v.mileageKmPerUnit }, cost);
    return {
      vehicleId: v.id,
      registrationNumber: v.registrationNumber,
      fuelType: v.fuelType,
      capacityKg: v.capacityKg,
      canCarry,
      durationMin: round(durationMin, 1),
      fuelUnits: round(e.fuelUnits, 2),
      fuelUnit: e.fuelUnit,
      fuelCost: round(e.fuelCost, 2),
      driverCost: round(e.driverCost, 2),
      operatingCost: round(e.operatingCost, 2),
      co2Kg: round(e.co2Kg, 2),
      co2PerTonneKm: body.loadKg > 0 ? round(e.co2Kg / ((body.loadKg / 1000) * body.distanceKm), 4) : null,
      assumptions: e.assumptions,
    };
  });
  rows.sort((a, b) => Number(b.canCarry) - Number(a.canCarry) || a.co2Kg - b.co2Kg);
  res.json({
    kind: "ESTIMATE",
    input: body,
    rows,
    assumptions: {
      emissionKgPerUnit: settings.emissionKgPerUnit,
      fuelPricePerUnit: settings.fuelPricePerUnit,
      loadPenaltyAtFullLoad: settings.loadPenaltyAtFullLoad,
      driverCostPerHour: settings.driverCostPerHour,
      notes: [
        "Estimates use each vehicle's configured mileage, adjusted linearly for load.",
        "CO₂ = fuel/energy × emission factor (tank-to-wheel; electricity uses the grid factor).",
        "Values are planning estimates, not measured emissions. Edit factors in Settings.",
      ],
    },
  });
});

/** Estimated (from trips) vs logged (from fuel records) per vehicle. */
router.get("/summary", async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req);
  const since = new Date(Date.now() - q.days * 86_400_000);
  const settings = await getCompanySettings(auth.companyId);
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId: auth.companyId },
    include: {
      trips: { where: { status: "COMPLETED", actualEnd: { gte: since } }, select: { plannedDistanceKm: true, estFuelUnits: true, estCo2Kg: true, estCost: true } },
      fuelRecords: { orderBy: { filledAt: "asc" } },
    },
    orderBy: { registrationNumber: "asc" },
  });
  const rows = vehicles.map((v) => {
    const est = v.trips.reduce(
      (a, t) => ({ km: a.km + (t.plannedDistanceKm ?? 0), fuel: a.fuel + (t.estFuelUnits ?? 0), co2: a.co2 + (t.estCo2Kg ?? 0), cost: a.cost + (t.estCost ?? 0) }),
      { km: 0, fuel: 0, co2: 0, cost: 0 },
    );
    const recent = v.fuelRecords.filter((r) => r.filledAt >= since);
    const loggedQty = recent.reduce((a, r) => a + r.quantity, 0);
    const loggedCost = recent.reduce((a, r) => a + r.totalCost, 0);
    const observed = observedEfficiency(v.fuelRecords);
    return {
      vehicleId: v.id,
      registrationNumber: v.registrationNumber,
      fuelType: v.fuelType,
      fuelUnit: FUEL_UNIT[v.fuelType],
      completedTrips: v.trips.length,
      estimated: { distanceKm: round(est.km, 1), fuelUnits: round(est.fuel, 2), co2Kg: round(est.co2, 2), operatingCost: round(est.cost, 2) },
      logged: {
        fills: recent.length,
        quantity: round(loggedQty, 2),
        cost: round(loggedCost, 2),
        co2KgFromFuel: round(loggedQty * settings.emissionKgPerUnit[v.fuelType], 2),
      },
      configuredMileage: v.mileageKmPerUnit,
      observedMileage: observed === null ? null : round(observed, 2),
    };
  });
  const totals = rows.reduce(
    (a, r) => ({ estCo2Kg: a.estCo2Kg + r.estimated.co2Kg, loggedCo2Kg: a.loggedCo2Kg + r.logged.co2KgFromFuel, estCost: a.estCost + r.estimated.operatingCost, loggedFuelCost: a.loggedFuelCost + r.logged.cost }),
    { estCo2Kg: 0, loggedCo2Kg: 0, estCost: 0, loggedFuelCost: 0 },
  );
  res.json({
    periodDays: q.days,
    rows,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v, 2)] as const)),
    notes: [
      "'Estimated' comes from planned trip distance and configured factors.",
      "'Logged' comes from fuel records entered by your team; CO₂ from logged fuel uses the same emission factors.",
      "Observed mileage needs at least two fills with increasing odometer readings (full-tank method).",
      "No ML model is used: there is not yet enough representative data to train and validate one.",
    ],
  });
});

router.get("/vehicle/:id", async (req, res) => {
  const auth = authOf(req);
  const v = await prisma.vehicle.findFirst({ where: { id: Number(req.params.id), companyId: auth.companyId }, include: { fuelRecords: { orderBy: { filledAt: "asc" } } } });
  if (!v) throw notFound("Vehicle");
  res.json({ vehicleId: v.id, observedMileage: observedEfficiency(v.fuelRecords), configuredMileage: v.mileageKmPerUnit, records: v.fuelRecords });
});

export default router;
