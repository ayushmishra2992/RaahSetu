import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { uploadLimiter } from "../../lib/rateLimits";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parsePatch, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { deleteStoredObjects, publicAttachment, storeAttachment, uploadFiles } from "../attachments/attachments.service";
import { assertTripCarriesOrder, driverOrderFilter, loadOrderFor, zGstin, zOptNumber, zText } from "./shipments.common";

/**
 * E-Way Bills are RECORDED here from details the transporter already obtained on
 * the government portal. RaahSetu does not generate, extend or cancel E-Way Bills
 * on the portal and does not verify them against it.
 */
const router = Router();

const zDateField = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.date());
const zOptDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable().optional());

const EwbBody = z.object({
  orderId: z.coerce.number().int().positive(),
  tripId: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().positive().nullable().optional()),
  ewbNumber: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{12}$/, "E-Way Bill number must be 12 digits")),
  documentDate: zDateField,
  validUntil: zOptDate,
  supplierName: z.string().trim().min(2).max(160),
  supplierGstin: zGstin,
  recipientName: z.string().trim().min(2).max(160),
  recipientGstin: zGstin,
  placeOfDispatch: z.string().trim().min(2).max(200),
  placeOfDelivery: z.string().trim().min(2).max(200),
  goodsDescription: z.string().trim().min(2).max(300),
  hsnCode: z
    .string()
    .trim()
    .regex(/^\d{4}(\d{2}){0,2}$/, "HSN code must be 4, 6 or 8 digits")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  quantity: zOptNumber(1e9),
  quantityUnit: zText(20),
  taxableValue: zOptNumber(1e12),
  invoiceOrChallanRef: zText(60),
  transporterId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/, "Transporter ID is the 15-character GSTIN/TRANSIN")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  vehicleNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^[A-Z0-9-]{4,15}$/, "Vehicle number must be 4–15 letters/digits"))
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  transportDocNumber: zText(40),
  notes: zText(1000),
});

function assertDates(documentDate: Date, validUntil?: Date | null) {
  if (validUntil && validUntil < documentDate) throw badRequest("Valid-until cannot be before the document date");
  if (documentDate.getTime() > Date.now() + 86_400_000) throw badRequest("Document date cannot be in the future");
}

const upload = uploadFiles(3).fields([{ name: "file", maxCount: 3 }]);
const include = { attachments: true, order: { select: { id: true, orderNumber: true, customerName: true } }, trip: { select: { id: true, tripNumber: true } } } as const;
type Row = Awaited<ReturnType<typeof prisma.ewayBill.findFirstOrThrow<{ include: typeof include }>>>;
const view = (e: Row) => ({ ...e, attachments: e.attachments.map(publicAttachment), expired: !!e.validUntil && e.validUntil < new Date() });

async function load(companyId: number, id: number) {
  const e = await prisma.ewayBill.findFirst({ where: { id, companyId }, include });
  if (!e) throw notFound("E-Way Bill");
  return e;
}

router.get("/", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ orderId: z.coerce.number().int().positive().optional(), tripId: z.coerce.number().int().positive().optional(), status: z.enum(["ACTIVE", "CANCELLED"]).optional() }), req);
  const rows = await prisma.ewayBill.findMany({
    where: {
      companyId: auth.companyId,
      orderId: q.orderId,
      status: q.status,
      AND: [...(q.tripId ? [{ order: { tripStops: { some: { tripId: q.tripId } } } }] : []), ...(auth.role === "DRIVER" ? [{ order: driverOrderFilter(auth) }] : [])],
    },
    include,
    orderBy: [{ documentDate: "desc" }, { id: "desc" }],
    take: 500,
  });
  res.json(rows.map(view));
});

router.get("/:id", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const e = await load(auth.companyId, parseId(req.params.id));
  await loadOrderFor(auth, e.orderId); // drivers: own trips only
  res.json(view(e));
});

router.post("/", requirePermission("shipments:write"), uploadLimiter, upload, async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(EwbBody, req);
  await loadOrderFor(auth, body.orderId);
  await assertTripCarriesOrder(auth.companyId, body.tripId, body.orderId);
  assertDates(body.documentDate, body.validUntil);
  if (await prisma.ewayBill.findFirst({ where: { companyId: auth.companyId, ewbNumber: body.ewbNumber } })) throw conflict(`E-Way Bill ${body.ewbNumber} is already recorded`);
  const e = await prisma.ewayBill.create({ data: { ...body, companyId: auth.companyId, createdById: auth.userId } });
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined)?.file ?? [];
  try {
    for (const f of files) await storeAttachment(auth, f, { ewayBillId: e.id }, "PAGE");
  } catch (err) {
    const atts = await prisma.attachment.findMany({ where: { ewayBillId: e.id } });
    await prisma.ewayBill.delete({ where: { id: e.id } });
    await deleteStoredObjects(auth.companyId, atts.map((a) => a.storageKey));
    throw err;
  }
  await audit(auth, "ewaybill.recorded", "EwayBill", e.id, { orderId: e.orderId, files: files.length });
  res.status(201).json(view(await load(auth.companyId, e.id)));
});

router.patch("/:id", requirePermission("shipments:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await load(auth.companyId, id);
  if (existing.status === "CANCELLED") throw conflict("A cancelled E-Way Bill record cannot be edited");
  const body = parsePatch(EwbBody.omit({ orderId: true }), req);
  if ("tripId" in body) await assertTripCarriesOrder(auth.companyId, body.tripId, existing.orderId);
  assertDates(body.documentDate ?? existing.documentDate, "validUntil" in body ? body.validUntil : existing.validUntil);
  if (body.ewbNumber && body.ewbNumber !== existing.ewbNumber && (await prisma.ewayBill.findFirst({ where: { companyId: auth.companyId, ewbNumber: body.ewbNumber } }))) {
    throw conflict(`E-Way Bill ${body.ewbNumber} is already recorded`);
  }
  await prisma.ewayBill.update({ where: { id }, data: body });
  await audit(auth, "ewaybill.updated", "EwayBill", id, { fields: Object.keys(body) });
  res.json(view(await load(auth.companyId, id)));
});

/** Marks the record cancelled in RaahSetu (cancel it on the government portal separately). */
router.post("/:id/cancel", requirePermission("shipments:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await load(auth.companyId, id);
  if (existing.status === "CANCELLED") throw conflict("Already cancelled");
  await prisma.ewayBill.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(auth, "ewaybill.cancelled", "EwayBill", id);
  res.json(view(await load(auth.companyId, id)));
});

router.post("/:id/files", requirePermission("shipments:write"), uploadLimiter, upload, async (req, res) => {
  const auth = authOf(req);
  const e = await load(auth.companyId, parseId(req.params.id));
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined)?.file ?? [];
  if (!files.length) throw badRequest("No file was uploaded");
  if (e.attachments.length + files.length > 5) throw badRequest("An E-Way Bill can have at most 5 files");
  const stored = [];
  for (const f of files) stored.push(await storeAttachment(auth, f, { ewayBillId: e.id }, "PAGE"));
  await audit(auth, "file.uploaded", "EwayBill", e.id, { files: stored.map((s) => ({ id: s.id, bytes: s.fileSizeBytes })) });
  res.status(201).json(stored.map(publicAttachment));
});

export default router;
