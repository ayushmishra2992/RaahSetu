import { Router } from "express";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { authOf } from "../../lib/http";
import { can } from "../../lib/permissions";
import { env } from "../../config/env";
import { packLimiter } from "../../lib/rateLimits";
import { readIfExists } from "../../lib/storage";
import { parseId } from "../../lib/validate";
import { createZip, type ZipEntry } from "../../lib/zip";
import { requirePermission } from "../../middleware/auth";
import { publicAttachment } from "../attachments/attachments.service";
import { billingPdfFor } from "../billing/billing.routes";
import { dispatchCheck, redactDispatchCheck, visibilityFor } from "../compliance/compliance.service";
import { lrPdfFor } from "./lorryReceipts.routes";
import { podPdfFor } from "./pods.routes";
import { loadTripFor } from "./shipments.common";

/** Mounted at /api/trips/:id/documents… (see app.ts). */
const router = Router({ mergeParams: true });

async function loadAll(companyId: number, tripId: number) {
  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: tripId, companyId },
    include: {
      vehicle: { include: { documents: { include: { attachments: true } } } },
      driver: { include: { documents: { include: { attachments: true } } } },
      stops: { orderBy: { sequence: "asc" }, include: { order: { select: { id: true, orderNumber: true, customerName: true, declaredValue: true, weightKg: true } }, location: { select: { name: true } } } },
      billingDocuments: { select: { id: true, kind: true, number: true, status: true, total: true } },
      pods: { include: { attachments: true, order: { select: { orderNumber: true } } } },
      lorryReceipts: { select: { id: true, lrNumber: true, status: true, orderId: true } },
    },
  });
  const orderIds = [...new Set(trip.stops.map((s) => s.orderId).filter((x): x is number => x != null))];
  const [ewayBills, orderLrs] = await Promise.all([
    prisma.ewayBill.findMany({ where: { companyId, orderId: { in: orderIds } }, include: { attachments: true } }),
    prisma.lorryReceipt.findMany({ where: { companyId, orderId: { in: orderIds } }, select: { id: true, lrNumber: true, status: true, orderId: true } }),
  ]);
  const lrs = [...new Map([...trip.lorryReceipts, ...orderLrs].map((l) => [l.id, l])).values()];
  return { trip, orderIds, ewayBills, lrs };
}

/** Everything about a trip's paperwork in one response, filtered by the caller's permissions. */
router.get("/", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const tripId = parseId(req.params.id);
  await loadTripFor(auth, tripId); // tenant + driver-own-trip check
  const { trip, orderIds, ewayBills, lrs } = await loadAll(auth.companyId, tripId);
  // Same trimming as everywhere else: drivers never see document numbers, non-KYC roles never see KYC items.
  const check = redactDispatchCheck(await dispatchCheck(prisma, auth.companyId, { vehicleId: trip.vehicleId, driverId: trip.driverId, orderIds }), visibilityFor(auth.role));
  const docsVisible = can(auth.role, "documents:read");
  const orders = trip.stops
    .filter((s) => s.type === "DROP" && s.order)
    .map((s) => ({
      ...s.order!,
      stopId: s.id,
      stopStatus: s.status,
      dropLocation: s.location.name,
      ewayBills: ewayBills.filter((e) => e.orderId === s.orderId).map(({ attachments, ...e }) => ({ ...e, attachments: attachments.map(publicAttachment) })),
      lorryReceipts: lrs.filter((l) => l.orderId === s.orderId),
      pod: (() => {
        const p = trip.pods.find((x) => x.tripStopId === s.id);
        if (!p) return null;
        const { verificationToken: _t, attachments, ...rest } = p;
        return { ...rest, attachments: attachments.map(publicAttachment) };
      })(),
    }));
  res.json({
    trip: { id: trip.id, tripNumber: trip.tripNumber, status: trip.status, vehicle: trip.vehicle.registrationNumber, driver: trip.driver.name },
    compliance: { eligible: check.eligible, blockers: check.blockers, warnings: check.warnings, vehicle: check.vehicle, driver: check.driver, shipments: check.shipments },
    vehicleDocuments: docsVisible ? trip.vehicle.documents.map(({ storageKey, attachments, ...d }) => ({ ...d, hasFile: !!storageKey || attachments.length > 0 })) : null,
    driverDocuments: docsVisible ? trip.driver.documents.filter((d) => d.type !== "KYC_ID").map(({ storageKey, attachments, ...d }) => ({ ...d, hasFile: !!storageKey || attachments.length > 0 })) : null,
    billing: can(auth.role, "billing:read") ? trip.billingDocuments : null,
    orders,
  });
});

/**
 * ZIP of the trip's paperwork. Only what the caller may see is included; a
 * MANIFEST.txt lists every item and why anything was left out.
 */
router.get("/pack", requirePermission("shipments:read"), packLimiter, async (req, res) => {
  const auth = authOf(req);
  const tripId = parseId(req.params.id);
  await loadTripFor(auth, tripId);
  const { trip, ewayBills, lrs } = await loadAll(auth.companyId, tripId);
  const entries: ZipEntry[] = [];
  const manifest: string[] = [`RaahSetu trip document pack — ${trip.tripNumber}`, `Generated ${new Date().toISOString()} for user #${auth.userId}`, ""];
  // Packs are built in memory: cap the total and list whatever does not fit.
  const budget = Math.floor(env.MAX_PACK_MB * 1024 * 1024);
  let used = 0;
  let omitted = 0;
  const fits = (bytes: number) => used + bytes <= budget;
  const add = (name: string, data: Buffer | null, label: string) => {
    if (!data) {
      manifest.push(`[missing ] ${label} — stored file not found (storage may have been reset)`);
    } else if (!fits(data.length)) {
      omitted++;
      manifest.push(`[omitted ] ${name} — ${label} (pack size limit of ${env.MAX_PACK_MB} MB reached; download it separately)`);
    } else {
      used += data.length;
      entries.push({ name, data });
      manifest.push(`[included] ${name} — ${label}`);
    }
  };
  /** Stored files: skip by their recorded size BEFORE loading them, so an oversized pack never fills memory. */
  const addStored = async (name: string, key: string, sizeBytes: number | null | undefined, label: string) => {
    if (sizeBytes != null && !fits(sizeBytes)) {
      omitted++;
      manifest.push(`[omitted ] ${name} — ${label} (pack size limit of ${env.MAX_PACK_MB} MB reached; download it separately)`);
      return;
    }
    add(name, await readIfExists(auth.companyId, key), label);
  };

  for (const lr of lrs.filter((l) => l.status === "ACTIVE")) {
    const { pdf, fileName } = await lrPdfFor(auth.companyId, lr.id);
    add(`lorry-receipts/${fileName}`, pdf, `Lorry receipt ${lr.lrNumber}`);
  }
  for (const e of ewayBills.filter((x) => x.status === "ACTIVE")) {
    if (!e.attachments.length) manifest.push(`[note    ] E-Way Bill ${e.ewbNumber} is recorded but no copy is attached`);
    for (const a of e.attachments) await addStored(`eway-bills/${e.ewbNumber}-${a.fileName}`, a.storageKey, a.fileSizeBytes, `E-Way Bill ${e.ewbNumber}`);
  }
  if (can(auth.role, "billing:read")) {
    for (const b of trip.billingDocuments.filter((x) => x.status !== "CANCELLED")) {
      const { pdf, fileName } = await billingPdfFor(auth.companyId, b.id);
      add(`${b.kind === "INVOICE" ? "invoices" : "challans"}/${fileName}`, pdf, `${b.kind === "INVOICE" ? "Invoice" : "Delivery challan"} ${b.number} (${b.status})`);
    }
  } else manifest.push("[excluded] Invoices and challans — your role cannot view billing");
  for (const p of trip.pods) {
    const { pdf, fileName } = await podPdfFor(auth.companyId, p.id);
    add(`proof-of-delivery/${fileName}`, pdf, `Proof of delivery ${p.order?.orderNumber ?? ""}`);
    for (const a of p.attachments.filter((x) => x.role === "PHOTO")) await addStored(`proof-of-delivery/photos/${p.order?.orderNumber ?? p.id}-${a.fileName}`, a.storageKey, a.fileSizeBytes, "Delivery photograph");
  }
  if (can(auth.role, "documents:read")) {
    const docs = [...trip.vehicle.documents.map((d) => ({ ...d, owner: `vehicle-${trip.vehicle.registrationNumber}` })), ...trip.driver.documents.filter((d) => d.type !== "KYC_ID").map((d) => ({ ...d, owner: "driver" }))];
    for (const d of docs) {
      const files = [...(d.storageKey ? [{ key: d.storageKey, name: d.fileName ?? "file", size: d.fileSizeBytes }] : []), ...d.attachments.map((a) => ({ key: a.storageKey, name: `${a.role.toLowerCase()}-${a.fileName}`, size: a.fileSizeBytes }))];
      if (!files.length) manifest.push(`[note    ] ${d.type} ${d.documentNumber} (${d.owner}) has no uploaded copy`);
      for (const f of files) await addStored(`${d.owner}/${d.type}-${d.documentNumber}-${f.name}`, f.key, f.size, `${d.type} ${d.documentNumber}`);
    }
    manifest.push("[excluded] Driver KYC identity proofs are never included in packs");
  } else manifest.push("[excluded] Vehicle and driver compliance documents — your role cannot view them");
  if (omitted) manifest.splice(3, 0, `NOTE: ${omitted} file(s) were left out because the pack reached its ${env.MAX_PACK_MB} MB limit (see [omitted] lines).`, "");
  entries.unshift({ name: "MANIFEST.txt", data: Buffer.from(manifest.join("\r\n") + "\r\n", "utf8") });

  const zip = createZip(entries);
  await audit(auth, "trip.document_pack_downloaded", "Trip", trip.id, { files: entries.length - 1, omitted, bytes: used });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${trip.tripNumber}-documents.zip"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(zip);
});

export default router;
