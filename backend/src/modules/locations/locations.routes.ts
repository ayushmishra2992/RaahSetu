import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parsePatch } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";

const router = Router();

const LocationBody = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional().nullable(),
  type: z.enum(["DEPOT", "WAREHOUSE", "CUSTOMER", "OTHER"]).default("CUSTOMER"),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  roadNodeId: z.coerce.number().int().positive().optional().nullable(),
});

async function assertNode(companyId: number, roadNodeId?: number | null) {
  if (!roadNodeId) return;
  if (!(await prisma.roadNode.findFirst({ where: { id: roadNodeId, companyId } }))) throw badRequest("Road node not found in your company");
}

router.get("/", requirePermission("locations:read"), async (req, res) => {
  const auth = authOf(req);
  res.json(await prisma.location.findMany({ where: { companyId: auth.companyId }, include: { roadNode: { select: { id: true, name: true } } }, orderBy: { name: "asc" } }));
});

router.post("/", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(LocationBody, req);
  await assertNode(auth.companyId, body.roadNodeId);
  const loc = await prisma.location.create({ data: { ...body, companyId: auth.companyId } });
  await audit(auth, "location.created", "Location", loc.id, { name: loc.name });
  res.status(201).json(loc);
});

router.patch("/:id", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const body = parsePatch(LocationBody, req);
  if (!(await prisma.location.findFirst({ where: { id, companyId: auth.companyId } }))) throw notFound("Location");
  await assertNode(auth.companyId, body.roadNodeId);
  const loc = await prisma.location.update({ where: { id }, data: body });
  await audit(auth, "location.updated", "Location", id, { fields: Object.keys(body) });
  res.json(loc);
});

router.delete("/:id", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const loc = await prisma.location.findFirst({
    where: { id, companyId: auth.companyId },
    include: { _count: { select: { pickupOrders: true, dropOrders: true, tripStops: true } } },
  });
  if (!loc) throw notFound("Location");
  if (loc._count.pickupOrders + loc._count.dropOrders + loc._count.tripStops > 0) throw conflict("Location is used by orders or trips");
  await prisma.location.delete({ where: { id } });
  await audit(auth, "location.deleted", "Location", id, { name: loc.name });
  res.status(204).end();
});

export default router;
