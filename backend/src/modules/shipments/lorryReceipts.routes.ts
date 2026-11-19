import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { docNumber } from "../../lib/numbering";
import { parseBody, parseId, parsePatch, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { lrPdf } from "./pdfs";
import { assertTripCarriesOrder, driverOrderFilter, issuerOf, loadOrderFor, placeOf, sendPdf, zGstin, zOptNumber, zText } from "./shipments.common";

const router = Router();

/** Everything except the order is optional: missing parts are filled from the order and trip. */
const LrBody = z.object({
  orderId: z.coerce.number().int().positive(),
  tripId: z.coerce.number().int().positive().nullable().optional(),
  bookingDate: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.date().optional()),
  consignorName: z.string().trim().min(2).max(160).optional(),
  consignorAddress: zText(300),
  consignorGstin: zGstin,
  consigneeName: z.string().trim().min(2).max(160).optional(),
  consigneeAddress: zText(300),
  consigneeGstin: zGstin,
  fromPlace: z.string().trim().min(2).max(200).optional(),
  toPlace: z.string().trim().min(2).max(200).optional(),
  goodsDescription: z.string().trim().min(2).max(300),
  packages: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().positive().max(1e6).nullable().optional()),
  packageType: zText(40),
  actualWeightKg: zOptNumber(1e6),
  chargedWeightKg: zOptNumber(1e6),
  freightAmount: zOptNumber(1e10),
  paymentTerms: z.enum(["PAID", "TO_PAY", "TO_BE_BILLED"]).default("TO_BE_BILLED"),
  declaredValue: zOptNumber(1e12),
  deliveryInstructions: zText(1000),
});

const include = { order: { select: { id: true, orderNumber: true } }, trip: { select: { id: true, tripNumber: true } } } as const;

async function load(companyId: number, id: number) {
  const lr = await prisma.lorryReceipt.findFirst({ where: { id, companyId }, include });
  if (!lr) throw notFound("Lorry receipt");
  return lr;
}

router.get("/", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ orderId: z.coerce.number().int().positive().optional(), tripId: z.coerce.number().int().positive().optional() }), req);
  res.json(
    await prisma.lorryReceipt.findMany({
      where: { companyId: auth.companyId, orderId: q.orderId, tripId: q.tripId, ...(auth.role === "DRIVER" ? { order: driverOrderFilter(auth) } : {}) },
      include,
      orderBy: [{ bookingDate: "desc" }, { id: "desc" }],
      take: 500,
    }),
  );
});

router.get("/:id", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const lr = await load(auth.companyId, parseId(req.params.id));
  await loadOrderFor(auth, lr.orderId);
  res.json(lr);
});

router.post("/", requirePermission("shipments:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(LrBody, req);
  const order = await loadOrderFor(auth, body.orderId);
  if (order.status === "CANCELLED") throw conflict("Cannot issue a lorry receipt for a cancelled order");
  // Default to the trip currently carrying the order, if any.
  const tripId =
    body.tripId ??
    (await prisma.tripStop.findFirst({ where: { orderId: order.id, trip: { companyId: auth.companyId, status: { not: "CANCELLED" } } }, orderBy: { id: "desc" }, select: { tripId: true } }))?.tripId ??
    null;
  await assertTripCarriesOrder(auth.companyId, tripId, order.id);
  const company = await issuerOf(auth.companyId);
  const data = {
    companyId: auth.companyId,
    orderId: order.id,
    tripId,
    bookingDate: body.bookingDate ?? new Date(),
    consignorName: body.consignorName ?? company.name,
    consignorAddress: body.consignorAddress ?? order.pickupLocation.address ?? placeOf(order.pickupLocation),
    consignorGstin: body.consignorGstin ?? null,
    consigneeName: body.consigneeName ?? order.customerName,
    consigneeAddress: body.consigneeAddress ?? order.dropLocation.address ?? placeOf(order.dropLocation),
    consigneeGstin: body.consigneeGstin ?? null,
    fromPlace: body.fromPlace ?? placeOf(order.pickupLocation),
    toPlace: body.toPlace ?? placeOf(order.dropLocation),
    goodsDescription: body.goodsDescription,
    packages: body.packages ?? null,
    packageType: body.packageType ?? null,
    actualWeightKg: body.actualWeightKg ?? order.weightKg,
    chargedWeightKg: body.chargedWeightKg ?? null,
    freightAmount: body.freightAmount ?? null,
    paymentTerms: body.paymentTerms,
    declaredValue: body.declaredValue ?? order.declaredValue ?? null,
    deliveryInstructions: body.deliveryInstructions ?? order.notes ?? null,
    createdById: auth.userId,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const lr = await prisma.lorryReceipt.create({ data: { ...data, lrNumber: docNumber("LR", data.bookingDate) }, include });
      await audit(auth, "lr.created", "LorryReceipt", lr.id, { lrNumber: lr.lrNumber, orderId: order.id });
      res.status(201).json(lr);
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt >= 2) throw e;
    }
  }
});

router.patch("/:id", requirePermission("shipments:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await load(auth.companyId, id);
  if (existing.status === "CANCELLED") throw conflict("A cancelled lorry receipt cannot be edited");
  const body = parsePatch(LrBody.omit({ orderId: true, paymentTerms: true }).extend({ paymentTerms: z.enum(["PAID", "TO_PAY", "TO_BE_BILLED"]) }), req);
  if ("tripId" in body) await assertTripCarriesOrder(auth.companyId, body.tripId, existing.orderId);
  const lr = await prisma.lorryReceipt.update({ where: { id }, data: body, include });
  await audit(auth, "lr.updated", "LorryReceipt", id, { fields: Object.keys(body) });
  res.json(lr);
});

router.post("/:id/cancel", requirePermission("shipments:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await load(auth.companyId, id);
  if (existing.status === "CANCELLED") throw conflict("Already cancelled");
  const lr = await prisma.lorryReceipt.update({ where: { id }, data: { status: "CANCELLED" }, include });
  await audit(auth, "lr.cancelled", "LorryReceipt", id, { lrNumber: lr.lrNumber });
  res.json(lr);
});

export async function lrPdfFor(companyId: number, id: number) {
  const lr = await prisma.lorryReceipt.findFirst({
    where: { id, companyId },
    include: {
      order: { select: { orderNumber: true, ewayBills: { where: { status: "ACTIVE" }, select: { ewbNumber: true } } } },
      trip: { include: { vehicle: { select: { registrationNumber: true, type: true } }, driver: { select: { name: true, phone: true, licenseNumber: true } } } },
    },
  });
  if (!lr) throw notFound("Lorry receipt");
  const pdf = await lrPdf({ ...lr, orderNumber: lr.order.orderNumber, ewayBills: lr.order.ewayBills.map((e) => e.ewbNumber), issuer: await issuerOf(companyId), trip: lr.trip });
  return { pdf, fileName: `${lr.lrNumber}.pdf` };
}

router.get("/:id/pdf", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const lr = await load(auth.companyId, parseId(req.params.id));
  await loadOrderFor(auth, lr.orderId);
  const { pdf, fileName } = await lrPdfFor(auth.companyId, lr.id);
  await audit(auth, "lr.pdf_downloaded", "LorryReceipt", lr.id);
  sendPdf(res, pdf, fileName, req.query.inline === "1");
});

export default router;
