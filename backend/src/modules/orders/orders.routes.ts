import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { docNumber } from "../../lib/numbering";
import { parseBody, parseId, parsePatch, parseQuery, zOptionalDate } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";

const router = Router();

const OrderStatus = z.enum(["PENDING", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]);

export const OrderShape = z.object({
    orderNumber: z.string().trim().max(40).optional(),
    customerName: z.string().trim().min(2).max(120),
    customerPhone: z.string().trim().max(20).optional().nullable(),
    pickupLocationId: z.coerce.number().int().positive(),
    dropLocationId: z.coerce.number().int().positive(),
    weightKg: z.coerce.number().int().positive().max(100000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    readyAt: zOptionalDate,
    windowStart: zOptionalDate,
    windowEnd: zOptionalDate,
    serviceMinutes: z.coerce.number().int().min(0).max(600).default(20),
    notes: z.string().trim().max(1000).optional().nullable(),
    declaredValue: z.coerce.number().nonnegative().optional().nullable(),
});

export const OrderBody = OrderShape
  .refine((o) => o.pickupLocationId !== o.dropLocationId, { message: "Pickup and drop must differ", path: ["dropLocationId"] })
  .refine((o) => !o.windowStart || !o.windowEnd || o.windowEnd > o.windowStart, { message: "Window end must be after window start", path: ["windowEnd"] });

export async function assertLocations(companyId: number, ids: number[]) {
  const unique = [...new Set(ids)];
  const count = await prisma.location.count({ where: { companyId, id: { in: unique } } });
  if (count !== unique.length) throw badRequest("Pickup/drop location not found in your company");
}

const include = {
  pickupLocation: { select: { id: true, name: true } },
  dropLocation: { select: { id: true, name: true } },
} as const;

router.get("/", requirePermission("orders:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ status: OrderStatus.optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional() }), req);
  res.json(await prisma.order.findMany({ where: { companyId: auth.companyId, status: q.status, priority: q.priority }, include, orderBy: [{ createdAt: "desc" }] }));
});

router.get("/:id", requirePermission("orders:read"), async (req, res) => {
  const auth = authOf(req);
  const order = await prisma.order.findFirst({
    where: { id: parseId(req.params.id), companyId: auth.companyId },
    include: { ...include, tripStops: { include: { trip: { select: { id: true, tripNumber: true, status: true } } } } },
  });
  if (!order) throw notFound("Order");
  res.json(order);
});

router.post("/", requirePermission("orders:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(OrderBody, req);
  await assertLocations(auth.companyId, [body.pickupLocationId, body.dropLocationId]);
  const order = await prisma.order.create({
    data: { ...body, orderNumber: body.orderNumber || docNumber("ORD"), companyId: auth.companyId },
    include,
  });
  await audit(auth, "order.created", "Order", order.id, { orderNumber: order.orderNumber, priority: order.priority });
  res.status(201).json(order);
});

router.patch("/:id", requirePermission("orders:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.order.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Order");
  if (existing.status !== "PENDING") throw conflict("Only PENDING orders can be edited");
  const body = parsePatch(OrderShape, req);
  const ws = body.windowStart === undefined ? existing.windowStart : body.windowStart;
  const we = body.windowEnd === undefined ? existing.windowEnd : body.windowEnd;
  if (ws && we && we <= ws) throw badRequest("Window end must be after window start");
  const pickup = body.pickupLocationId ?? existing.pickupLocationId;
  const drop = body.dropLocationId ?? existing.dropLocationId;
  if (pickup === drop) throw badRequest("Pickup and drop must differ");
  await assertLocations(auth.companyId, [pickup, drop]);
  const order = await prisma.order.update({ where: { id }, data: body, include });
  await audit(auth, "order.updated", "Order", id, { fields: Object.keys(body) });
  res.json(order);
});

router.post("/:id/cancel", requirePermission("orders:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.order.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Order");
  if (existing.status !== "PENDING") throw conflict("Only PENDING orders can be cancelled; cancel the trip first");
  const order = await prisma.order.update({ where: { id }, data: { status: "CANCELLED" }, include });
  await audit(auth, "order.cancelled", "Order", id);
  res.json(order);
});

router.delete("/:id", requirePermission("orders:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.order.findFirst({
    where: { id, companyId: auth.companyId },
    include: { _count: { select: { tripStops: true, ewayBills: true, lorryReceipts: true } } },
  });
  if (!existing) throw notFound("Order");
  if (existing._count.tripStops > 0) throw conflict("Order is part of a trip and cannot be deleted");
  // E-Way Bills and lorry receipts (even cancelled ones) are shipment records with
  // stored files; deleting the order would cascade them away. Keep them: cancel instead.
  const { ewayBills, lorryReceipts } = existing._count;
  if (ewayBills || lorryReceipts) {
    const what = [ewayBills ? `${ewayBills} E-Way Bill${ewayBills === 1 ? "" : "s"}` : null, lorryReceipts ? `${lorryReceipts} lorry receipt${lorryReceipts === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
    throw new AppError(409, `Order has ${what} recorded and cannot be deleted. Use "Cancel order" instead; shipment records are kept.`, "ORDER_HAS_SHIPMENT_DOCUMENTS", { ewayBills, lorryReceipts });
  }
  await prisma.order.delete({ where: { id } });
  await audit(auth, "order.deleted", "Order", id, { orderNumber: existing.orderNumber });
  res.status(204).end();
});

export default router;
