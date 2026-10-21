import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";

const router = Router();

router.get("/", requirePermission("greenfleet:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ vehicleId: z.coerce.number().int().positive().optional() }), req);
  res.json(
    await prisma.fuelRecord.findMany({
      where: { companyId: auth.companyId, vehicleId: q.vehicleId },
      include: { vehicle: { select: { id: true, registrationNumber: true, fuelType: true } } },
      orderBy: { filledAt: "desc" },
      take: 300,
    }),
  );
});

const FuelBody = z.object({
  vehicleId: z.coerce.number().int().positive(),
  filledAt: z.coerce.date(),
  quantity: z.coerce.number().positive().max(2000),
  totalCost: z.coerce.number().nonnegative().max(1e7),
  odometerKm: z.coerce.number().int().nonnegative(),
  notes: z.string().trim().max(500).optional().nullable(),
});

router.post("/", requirePermission("fuel:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(FuelBody, req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: body.vehicleId, companyId: auth.companyId } });
  if (!vehicle) throw badRequest("Vehicle not found");
  const record = await prisma.$transaction(async (tx) => {
    const r = await tx.fuelRecord.create({ data: { ...body, companyId: auth.companyId } });
    if (body.odometerKm > vehicle.odometerKm) await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: body.odometerKm } });
    return r;
  });
  await audit(auth, "fuel.recorded", "FuelRecord", record.id, { vehicleId: vehicle.id });
  res.status(201).json(record);
});

router.delete("/:id", requirePermission("fuel:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  if (!(await prisma.fuelRecord.findFirst({ where: { id, companyId: auth.companyId } }))) throw notFound("Fuel record");
  await prisma.fuelRecord.delete({ where: { id } });
  await audit(auth, "fuel.deleted", "FuelRecord", id);
  res.status(204).end();
});

export default router;
