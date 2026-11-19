import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parsePatch, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { deleteStoredObjects, publicAttachment } from "../attachments/attachments.service";
import { getCompanySettings } from "../company/settings";
import { redactCompliance } from "../compliance/compliance";
import { vehicleCompliance, visibilityFor } from "../compliance/compliance.service";

const router = Router();

const VehicleBody = z.object({
  registrationNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^[A-Z0-9-]{4,15}$/, "Registration must be 4–15 letters/digits")),
  type: z.enum(["TRUCK", "MINI_TRUCK", "VAN", "PICKUP", "TRAILER", "TANKER"]),
  make: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  year: z.coerce.number().int().min(1980).max(2100).optional().nullable(),
  capacityKg: z.coerce.number().int().positive().max(100000),
  fuelType: z.enum(["DIESEL", "PETROL", "CNG", "ELECTRIC"]),
  mileageKmPerUnit: z.coerce.number().positive().max(100),
  avgSpeedKmph: z.coerce.number().positive().max(120).default(40),
  status: z.enum(["AVAILABLE", "ON_TRIP", "MAINTENANCE", "INACTIVE"]).optional(),
  odometerKm: z.coerce.number().int().nonnegative().optional(),
  depotLocationId: z.coerce.number().int().positive().optional().nullable(),
  registrationState: z.string().trim().max(60).optional().nullable(),
  ownershipType: z.enum(["OWNED", "LEASED", "ATTACHED"]).optional(),
  ownerName: z.string().trim().max(120).optional().nullable(),
  ownerPhone: z
    .string()
    .trim()
    .regex(/^[+0-9 -]{7,20}$/, "Enter a valid phone number")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  fastagId: z.string().trim().max(40).optional().nullable(),
});

async function assertDepot(companyId: number, depotLocationId?: number | null) {
  if (!depotLocationId) return;
  const loc = await prisma.location.findFirst({ where: { id: depotLocationId, companyId } });
  if (!loc) throw badRequest("Depot location not found in your company");
}

router.get("/", requirePermission("fleet:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ status: z.enum(["AVAILABLE", "ON_TRIP", "MAINTENANCE", "INACTIVE"]).optional(), search: z.string().optional() }), req);
  const vehicles = await prisma.vehicle.findMany({
    where: {
      companyId: auth.companyId,
      status: q.status,
      ...(q.search ? { registrationNumber: { contains: q.search.toUpperCase() } } : {}),
    },
    include: { depotLocation: { select: { id: true, name: true } } },
    orderBy: { registrationNumber: "asc" },
  });
  res.json(vehicles);
});

router.get("/:id", requirePermission("fleet:read"), async (req, res) => {
  const auth = authOf(req);
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: parseId(req.params.id), companyId: auth.companyId },
    include: {
      depotLocation: true,
      documents: { orderBy: { expiresOn: "asc" }, include: { attachments: true } },
      trips: { orderBy: { plannedStart: "desc" }, take: 10, include: { driver: { select: { id: true, name: true } } } },
      fuelRecords: { orderBy: { filledAt: "desc" }, take: 10 },
    },
  });
  if (!vehicle) throw notFound("Vehicle");
  const settings = await getCompanySettings(auth.companyId);
  res.json({
    ...vehicle,
    // Storage keys are internal: never sent to clients.
    documents: vehicle.documents.map(({ storageKey, attachments, ...d }) => ({ ...d, hasFile: !!storageKey || attachments.length > 0, attachments: attachments.map(publicAttachment) })),
    compliance: redactCompliance(vehicleCompliance(vehicle, settings), visibilityFor(auth.role)),
  });
});

router.post("/", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(VehicleBody, req);
  await assertDepot(auth.companyId, body.depotLocationId);
  const vehicle = await prisma.vehicle.create({ data: { ...body, companyId: auth.companyId } });
  await audit(auth, "vehicle.created", "Vehicle", vehicle.id, { registrationNumber: vehicle.registrationNumber });
  res.status(201).json(vehicle);
});

router.patch("/:id", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const body = parsePatch(VehicleBody, req);
  const existing = await prisma.vehicle.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Vehicle");
  await assertDepot(auth.companyId, body.depotLocationId);
  if (body.status && body.status !== existing.status && existing.status === "ON_TRIP") {
    throw conflict("Vehicle is on an active trip; complete or cancel the trip first");
  }
  if (body.status === "ON_TRIP" && existing.status !== "ON_TRIP") {
    throw badRequest("ON_TRIP is set automatically when a trip is dispatched");
  }
  const vehicle = await prisma.vehicle.update({ where: { id }, data: body });
  await audit(auth, "vehicle.updated", "Vehicle", id, { fields: Object.keys(body) });
  res.json(vehicle);
});

router.delete("/:id", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.vehicle.findFirst({ where: { id, companyId: auth.companyId }, include: { _count: { select: { trips: true } } } });
  if (!existing) throw notFound("Vehicle");
  if (existing._count.trips > 0) throw conflict("Vehicle has trip history; set its status to INACTIVE instead of deleting");
  const docs = await prisma.complianceDocument.findMany({ where: { vehicleId: id, companyId: auth.companyId }, select: { storageKey: true, attachments: { select: { storageKey: true } } } });
  await prisma.vehicle.delete({ where: { id } }); // documents and attachments cascade
  await deleteStoredObjects(auth.companyId, docs.flatMap((d) => [d.storageKey, ...d.attachments.map((a) => a.storageKey)]));
  await audit(auth, "vehicle.deleted", "Vehicle", id, { registrationNumber: existing.registrationNumber });
  res.status(204).end();
});

export default router;
