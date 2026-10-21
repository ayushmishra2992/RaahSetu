import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parsePatch, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";

const router = Router();

const DriverBody = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[+0-9 -]{7,20}$/, "Enter a valid phone number"),
  licenseNumber: z.string().trim().toUpperCase().min(5).max(30),
  licenseExpiry: z.coerce.date(),
  status: z.enum(["AVAILABLE", "ON_TRIP", "OFF_DUTY", "INACTIVE"]).optional(),
  maxShiftHours: z.coerce.number().min(1).max(16).default(10),
  userId: z.coerce.number().int().positive().optional().nullable(),
});

async function assertDriverUser(companyId: number, userId?: number | null, driverId?: number) {
  if (!userId) return;
  const user = await prisma.user.findFirst({ where: { id: userId, companyId }, include: { driver: true } });
  if (!user) throw badRequest("Linked user not found in your company");
  if (user.role !== "DRIVER") throw badRequest("Linked user must have the DRIVER role");
  if (user.driver && user.driver.id !== driverId) throw conflict("That user is already linked to another driver");
}

router.get("/", requirePermission("fleet:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ status: z.enum(["AVAILABLE", "ON_TRIP", "OFF_DUTY", "INACTIVE"]).optional() }), req);
  res.json(
    await prisma.driver.findMany({
      where: { companyId: auth.companyId, status: q.status },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { name: "asc" },
    }),
  );
});

router.get("/:id", requirePermission("fleet:read"), async (req, res) => {
  const auth = authOf(req);
  const driver = await prisma.driver.findFirst({
    where: { id: parseId(req.params.id), companyId: auth.companyId },
    include: {
      user: { select: { id: true, email: true } },
      documents: { orderBy: { expiresOn: "asc" } },
      trips: { orderBy: { plannedStart: "desc" }, take: 10, include: { vehicle: { select: { id: true, registrationNumber: true } } } },
    },
  });
  if (!driver) throw notFound("Driver");
  res.json(driver);
});

router.post("/", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(DriverBody, req);
  await assertDriverUser(auth.companyId, body.userId);
  const driver = await prisma.driver.create({ data: { ...body, companyId: auth.companyId } });
  await audit(auth, "driver.created", "Driver", driver.id, { name: driver.name });
  res.status(201).json(driver);
});

router.patch("/:id", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const body = parsePatch(DriverBody, req);
  const existing = await prisma.driver.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Driver");
  await assertDriverUser(auth.companyId, body.userId, id);
  if (body.status && body.status !== existing.status && existing.status === "ON_TRIP") {
    throw conflict("Driver is on an active trip; complete or cancel the trip first");
  }
  if (body.status === "ON_TRIP" && existing.status !== "ON_TRIP") {
    throw badRequest("ON_TRIP is set automatically when a trip is dispatched");
  }
  const driver = await prisma.driver.update({ where: { id }, data: body });
  await audit(auth, "driver.updated", "Driver", id, { fields: Object.keys(body) });
  res.json(driver);
});

router.delete("/:id", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.driver.findFirst({ where: { id, companyId: auth.companyId }, include: { _count: { select: { trips: true } } } });
  if (!existing) throw notFound("Driver");
  if (existing._count.trips > 0) throw conflict("Driver has trip history; set status to INACTIVE instead of deleting");
  await prisma.driver.delete({ where: { id } });
  await audit(auth, "driver.deleted", "Driver", id, { name: existing.name });
  res.status(204).end();
});

export default router;
