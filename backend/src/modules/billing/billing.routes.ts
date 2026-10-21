import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import type { BillingStatus } from "../../generated/prisma/enums";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { verificationToken } from "../../lib/tokens";
import { parseBody, parseId, parseQuery, zOptionalDate } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { computeTotals } from "./billing.service";

const router = Router();

const Kind = z.enum(["INVOICE", "DELIVERY_CHALLAN"]);
const Item = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().positive().max(1e6),
  unit: z.string().trim().max(20).optional(),
  rate: z.coerce.number().nonnegative().max(1e9),
});
const BillingBody = z.object({
  kind: Kind.default("INVOICE"),
  tripId: z.coerce.number().int().positive().optional().nullable(),
  customerName: z.string().trim().min(2).max(120),
  customerGstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 alphanumeric characters")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  customerAddress: z.string().trim().max(300).optional().nullable(),
  taxRatePercent: z.coerce.number().min(0).max(28).default(18),
  dueDate: zOptionalDate,
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(Item).min(1).max(50),
});

async function assertTrip(companyId: number, tripId?: number | null) {
  if (!tripId) return;
  if (!(await prisma.trip.findFirst({ where: { id: tripId, companyId } }))) throw badRequest("Trip not found");
}

async function nextNumber(companyId: number, kind: "INVOICE" | "DELIVERY_CHALLAN") {
  const count = await prisma.billingDocument.count({ where: { companyId, kind } });
  const prefix = kind === "INVOICE" ? "INV" : "DC";
  return `${prefix}-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
}

const include = { items: true, trip: { select: { id: true, tripNumber: true } } } as const;

router.get("/", requirePermission("billing:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ kind: Kind.optional(), status: z.enum(["DRAFT", "ISSUED", "PAID", "CANCELLED"]).optional() }), req);
  const docs = await prisma.billingDocument.findMany({
    where: { companyId: auth.companyId, kind: q.kind, status: q.status },
    include: { trip: { select: { id: true, tripNumber: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(docs.map(({ verificationToken: _t, ...d }) => d));
});

router.get("/:id", requirePermission("billing:read"), async (req, res) => {
  const auth = authOf(req);
  const doc = await prisma.billingDocument.findFirst({ where: { id: parseId(req.params.id), companyId: auth.companyId }, include: { ...include, company: true } });
  if (!doc) throw notFound("Billing document");
  const { company, ...rest } = doc;
  res.json({ ...rest, seller: { name: company.name, gstNumber: company.gstNumber, address: company.address, city: company.city, state: company.state } });
});

router.post("/", requirePermission("billing:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(BillingBody, req);
  await assertTrip(auth.companyId, body.tripId);
  const totals = computeTotals(body.items, body.taxRatePercent, body.kind);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const doc = await prisma.billingDocument.create({
        data: {
          companyId: auth.companyId,
          kind: body.kind,
          number: await nextNumber(auth.companyId, body.kind),
          tripId: body.tripId ?? null,
          customerName: body.customerName,
          customerGstin: body.customerGstin ?? null,
          customerAddress: body.customerAddress ?? null,
          taxRatePercent: totals.taxRatePercent,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          total: totals.total,
          dueDate: body.dueDate ?? null,
          notes: body.notes ?? null,
          verificationToken: verificationToken(),
          items: { create: totals.lines },
        },
        include,
      });
      await audit(auth, "billing.created", "BillingDocument", doc.id, { kind: doc.kind, number: doc.number });
      res.status(201).json(doc);
      return;
    } catch (e) {
      lastError = e;
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw lastError;
});

router.put("/:id", requirePermission("billing:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.billingDocument.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Billing document");
  if (existing.status !== "DRAFT") throw conflict("Only DRAFT documents can be edited");
  const body = parseBody(BillingBody.omit({ kind: true }), req);
  await assertTrip(auth.companyId, body.tripId);
  const totals = computeTotals(body.items, body.taxRatePercent, existing.kind);
  const doc = await prisma.$transaction(async (tx) => {
    await tx.billingItem.deleteMany({ where: { documentId: id } });
    return tx.billingDocument.update({
      where: { id },
      data: {
        tripId: body.tripId ?? null,
        customerName: body.customerName,
        customerGstin: body.customerGstin ?? null,
        customerAddress: body.customerAddress ?? null,
        taxRatePercent: totals.taxRatePercent,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        dueDate: body.dueDate ?? null,
        notes: body.notes ?? null,
        items: { create: totals.lines },
      },
      include,
    });
  });
  await audit(auth, "billing.updated", "BillingDocument", id);
  res.json(doc);
});

const STATUS_FLOW: Record<string, { from: BillingStatus[]; to: BillingStatus }> = {
  issue: { from: ["DRAFT"], to: "ISSUED" },
  "mark-paid": { from: ["ISSUED"], to: "PAID" },
  cancel: { from: ["DRAFT", "ISSUED"], to: "CANCELLED" },
};

router.post("/:id/:action", requirePermission("billing:write"), async (req, res) => {
  const auth = authOf(req);
  const flow = STATUS_FLOW[String(req.params.action)];
  if (!flow) throw notFound("Action");
  const id = parseId(req.params.id);
  const existing = await prisma.billingDocument.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Billing document");
  if (!flow.from.includes(existing.status)) throw conflict(`Cannot ${req.params.action} a ${existing.status} document`);
  if (flow.to === "PAID" && existing.kind === "DELIVERY_CHALLAN") throw conflict("Delivery challans are not paid");
  const doc = await prisma.billingDocument.update({
    where: { id },
    data: { status: flow.to, ...(flow.to === "ISSUED" ? { issuedAt: new Date() } : {}) },
    include,
  });
  await audit(auth, `billing.${flow.to.toLowerCase()}`, "BillingDocument", id, { number: doc.number });
  res.json(doc);
});

router.get("/:id/qr", requirePermission("billing:read"), async (req, res) => {
  const auth = authOf(req);
  const doc = await prisma.billingDocument.findFirst({ where: { id: parseId(req.params.id), companyId: auth.companyId } });
  if (!doc) throw notFound("Billing document");
  const url = `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/verify/${doc.verificationToken}`;
  res.json({ url, dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 280 }) });
});

export default router;
