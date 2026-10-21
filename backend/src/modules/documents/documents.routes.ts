import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { storageKey } from "../../lib/tokens";
import { parseBody, parseId, parsePatch, parseQuery, zOptionalDate } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { getCompanySettings } from "../company/settings";
import { assertAllowedFile, deleteStoredFile, readStoredFile, saveFile } from "./storage";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

const DocType = z.enum(["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "DRIVING_LICENSE", "OTHER"]);

const DocBody = z.object({
  type: DocType,
  documentNumber: z.string().trim().min(1).max(60),
  issuedOn: zOptionalDate,
  expiresOn: zOptionalDate,
  notes: z.string().trim().max(1000).optional().nullable(),
  vehicleId: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().positive().nullable().optional()),
  driverId: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().positive().nullable().optional()),
});

async function assertOwner(companyId: number, vehicleId?: number | null, driverId?: number | null) {
  if (!vehicleId && !driverId) throw badRequest("Attach the document to a vehicle or a driver");
  if (vehicleId && driverId) throw badRequest("Attach the document to either a vehicle or a driver, not both");
  if (vehicleId && !(await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId } }))) throw badRequest("Vehicle not found");
  if (driverId && !(await prisma.driver.findFirst({ where: { id: driverId, companyId } }))) throw badRequest("Driver not found");
}

export function expiryState(expiresOn: Date | null, alertDays: number, now = new Date()) {
  if (!expiresOn) return "NO_EXPIRY" as const;
  const days = Math.floor((expiresOn.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return "EXPIRED" as const;
  if (days <= alertDays) return "EXPIRING_SOON" as const;
  return "VALID" as const;
}

router.get("/", requirePermission("documents:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(
    z.object({
      type: DocType.optional(),
      vehicleId: z.coerce.number().int().positive().optional(),
      driverId: z.coerce.number().int().positive().optional(),
      expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
    }),
    req,
  );
  const settings = await getCompanySettings(auth.companyId);
  const docs = await prisma.complianceDocument.findMany({
    where: {
      companyId: auth.companyId,
      type: q.type,
      vehicleId: q.vehicleId,
      driverId: q.driverId,
      ...(q.expiringWithinDays !== undefined ? { expiresOn: { lte: new Date(Date.now() + q.expiringWithinDays * 86_400_000) } } : {}),
    },
    include: { vehicle: { select: { id: true, registrationNumber: true } }, driver: { select: { id: true, name: true } } },
    orderBy: [{ expiresOn: "asc" }],
  });
  res.json(docs.map((d) => ({ ...d, storageKey: undefined, hasFile: !!d.storageKey, expiryState: expiryState(d.expiresOn, settings.documentExpiryAlertDays) })));
});

router.post("/", requirePermission("documents:write"), upload.single("file"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(DocBody, req);
  await assertOwner(auth.companyId, body.vehicleId, body.driverId);
  let fileData: { fileName?: string; fileMimeType?: string; fileSizeBytes?: number; storageKey?: string } = {};
  let key: string | null = null;
  if (req.file) {
    assertAllowedFile(req.file.mimetype, req.file.buffer);
    key = storageKey();
    await saveFile(auth.companyId, key, req.file.buffer);
    fileData = { fileName: req.file.originalname.slice(0, 200), fileMimeType: req.file.mimetype, fileSizeBytes: req.file.size, storageKey: key };
  }
  try {
    const doc = await prisma.complianceDocument.create({ data: { ...body, ...fileData, companyId: auth.companyId } });
    await audit(auth, "document.created", "ComplianceDocument", doc.id, { type: doc.type, hasFile: !!key });
    res.status(201).json({ ...doc, storageKey: undefined, hasFile: !!key });
  } catch (e) {
    if (key) await deleteStoredFile(auth.companyId, key);
    throw e;
  }
});

router.patch("/:id", requirePermission("documents:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.complianceDocument.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Document");
  const body = parsePatch(DocBody, req);
  if ("vehicleId" in body || "driverId" in body) {
    await assertOwner(auth.companyId, "vehicleId" in body ? body.vehicleId : existing.vehicleId, "driverId" in body ? body.driverId : existing.driverId);
  }
  const doc = await prisma.complianceDocument.update({ where: { id }, data: body });
  await audit(auth, "document.updated", "ComplianceDocument", id, { fields: Object.keys(body) });
  res.json({ ...doc, storageKey: undefined, hasFile: !!doc.storageKey });
});

router.delete("/:id", requirePermission("documents:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.complianceDocument.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Document");
  await prisma.complianceDocument.delete({ where: { id } });
  if (existing.storageKey) await deleteStoredFile(auth.companyId, existing.storageKey);
  await audit(auth, "document.deleted", "ComplianceDocument", id, { type: existing.type });
  res.status(204).end();
});

/** Authenticated, tenant-checked download. Files are never served statically. */
router.get("/:id/file", requirePermission("documents:read"), async (req, res) => {
  const auth = authOf(req);
  const doc = await prisma.complianceDocument.findFirst({ where: { id: parseId(req.params.id), companyId: auth.companyId } });
  if (!doc || !doc.storageKey) throw notFound("Document file");
  const data = await readStoredFile(auth.companyId, doc.storageKey).catch(() => null);
  if (!data) throw notFound("Document file");
  res.setHeader("Content-Type", doc.fileMimeType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${(doc.fileName ?? "document").replace(/[^A-Za-z0-9._-]/g, "_")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
});

export default router;
