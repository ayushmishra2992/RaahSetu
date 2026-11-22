import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { can } from "../../lib/permissions";
import { uploadLimiter } from "../../lib/rateLimits";
import { contentDisposition, readIfExists } from "../../lib/storage";
import { parseBody, parseId, parsePatch, parseQuery, zOptionalDate } from "../../lib/validate";
import { requirePermission, type AuthContext } from "../../middleware/auth";
import { deleteStoredObjects, publicAttachment, storeAttachment, uploadFiles } from "../attachments/attachments.service";
import { getCompanySettings } from "../company/settings";

const router = Router();

const DOC_TYPES = ["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "STATE_PERMIT", "FASTAG", "DRIVING_LICENSE", "DRIVER_PHOTO", "KYC_ID", "OTHER"] as const;
const DocType = z.enum(DOC_TYPES);
const VEHICLE_TYPES = new Set(["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "STATE_PERMIT", "FASTAG", "OTHER"]);
const DRIVER_TYPES = new Set(["DRIVING_LICENSE", "DRIVER_PHOTO", "KYC_ID", "OTHER"]);

const DocBody = z.object({
  type: DocType,
  documentNumber: z.string().trim().min(1).max(60),
  issuedOn: zOptionalDate,
  expiresOn: zOptionalDate,
  notes: z.string().trim().max(1000).optional().nullable(),
  vehicleId: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().positive().nullable().optional()),
  driverId: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().positive().nullable().optional()),
});

/** File fields accepted on create / add-files. `file` is the original single-file field. */
const upload = uploadFiles(8).fields([
  { name: "file", maxCount: 1 },
  { name: "front", maxCount: 1 },
  { name: "back", maxCount: 1 },
  { name: "pages", maxCount: 5 },
]);
type Files = Record<string, Express.Multer.File[] | undefined>;
const filesOf = (req: Request) => (req.files ?? {}) as Files;
const ROLE_OF_FIELD = { file: "PAGE", front: "FRONT", back: "BACK", pages: "PAGE" } as const;

/** KYC identity proofs are visible only to roles with the KYC permission. */
const isKyc = (type: string) => type === "KYC_ID";
const canSeeType = (auth: AuthContext, type: string, mode: "read" | "write") => !isKyc(type) || can(auth.role, mode === "read" ? "kyc:read" : "kyc:write");

async function assertOwner(companyId: number, type: string, vehicleId?: number | null, driverId?: number | null) {
  if (!vehicleId && !driverId) throw badRequest("Attach the document to a vehicle or a driver");
  if (vehicleId && driverId) throw badRequest("Attach the document to either a vehicle or a driver, not both");
  if (vehicleId && !VEHICLE_TYPES.has(type)) throw badRequest(`${type} is a driver document, not a vehicle document`);
  if (driverId && !DRIVER_TYPES.has(type)) throw badRequest(`${type} is a vehicle document, not a driver document`);
  if (vehicleId && !(await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId } }))) throw badRequest("Vehicle not found");
  if (driverId && !(await prisma.driver.findFirst({ where: { id: driverId, companyId } }))) throw badRequest("Driver not found");
}

/** KYC proofs: refuse anything that looks like a full 12-digit Aadhaar number. */
function assertMaskedId(type: string, documentNumber?: string) {
  if (type !== "KYC_ID" || !documentNumber) return;
  if (/\d{12}/.test(documentNumber.replace(/[\s-]/g, ""))) {
    throw badRequest("Do not store full Aadhaar/ID numbers. Enter a masked number such as XXXX-XXXX-1234.");
  }
}

function assertDates(issuedOn?: Date | null, expiresOn?: Date | null) {
  if (issuedOn && expiresOn && expiresOn < issuedOn) throw badRequest("Expiry date cannot be before the issue date");
  if (issuedOn && issuedOn.getTime() > Date.now() + 86_400_000) throw badRequest("Issue date cannot be in the future");
}

export function expiryState(expiresOn: Date | null, alertDays: number, now = new Date()) {
  if (!expiresOn) return "NO_EXPIRY" as const;
  const days = Math.floor((expiresOn.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return "EXPIRED" as const;
  if (days <= alertDays) return "EXPIRING_SOON" as const;
  return "VALID" as const;
}

type DocRow = Awaited<ReturnType<typeof prisma.complianceDocument.findFirstOrThrow>> & { attachments?: Parameters<typeof publicAttachment>[0][] };
function view(d: DocRow, alertDays?: number) {
  const { storageKey, attachments, ...rest } = d;
  return {
    ...rest,
    hasFile: !!storageKey || !!attachments?.length,
    hasLegacyFile: !!storageKey,
    attachments: (attachments ?? []).map(publicAttachment),
    ...(alertDays !== undefined ? { expiryState: expiryState(d.expiresOn, alertDays) } : {}),
  };
}

async function loadDoc(auth: AuthContext, id: number, mode: "read" | "write") {
  const doc = await prisma.complianceDocument.findFirst({ where: { id, companyId: auth.companyId }, include: { attachments: true } });
  if (!doc || !canSeeType(auth, doc.type, mode)) throw notFound("Document");
  return doc;
}

async function storeFiles(auth: AuthContext, docId: number, files: Files) {
  const stored = [];
  for (const field of Object.keys(ROLE_OF_FIELD) as Array<keyof typeof ROLE_OF_FIELD>) {
    for (const f of files[field] ?? []) stored.push(await storeAttachment(auth, f, { complianceDocumentId: docId }, ROLE_OF_FIELD[field]));
  }
  return stored;
}

router.get("/", requirePermission("documents:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(
    z.object({
      type: DocType.optional(),
      vehicleId: z.coerce.number().int().positive().optional(),
      driverId: z.coerce.number().int().positive().optional(),
      expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
      verificationStatus: z.enum(["PENDING", "VERIFIED", "REJECTED"]).optional(),
    }),
    req,
  );
  const settings = await getCompanySettings(auth.companyId);
  // Without the KYC permission, KYC identity proofs are simply not listed.
  const typeFilter = can(auth.role, "kyc:read") ? q.type : q.type === "KYC_ID" ? { in: [] } : (q.type ?? { not: "KYC_ID" as const });
  const docs = await prisma.complianceDocument.findMany({
    where: {
      companyId: auth.companyId,
      type: typeFilter,
      vehicleId: q.vehicleId,
      driverId: q.driverId,
      verificationStatus: q.verificationStatus,
      ...(q.expiringWithinDays !== undefined ? { expiresOn: { lte: new Date(Date.now() + q.expiringWithinDays * 86_400_000) } } : {}),
    },
    include: { vehicle: { select: { id: true, registrationNumber: true } }, driver: { select: { id: true, name: true } }, attachments: true },
    orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
  });
  res.json(docs.map((d) => view(d, settings.documentExpiryAlertDays)));
});

router.get("/:id", requirePermission("documents:read"), async (req, res) => {
  const auth = authOf(req);
  const settings = await getCompanySettings(auth.companyId);
  res.json(view(await loadDoc(auth, parseId(req.params.id), "read"), settings.documentExpiryAlertDays));
});

router.post("/", requirePermission("documents:write"), uploadLimiter, upload, async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(DocBody, req);
  if (!canSeeType(auth, body.type, "write")) throw badRequest("You do not have permission to add KYC documents");
  await assertOwner(auth.companyId, body.type, body.vehicleId, body.driverId);
  assertDates(body.issuedOn, body.expiresOn);
  assertMaskedId(body.type, body.documentNumber);
  const doc = await prisma.complianceDocument.create({ data: { ...body, companyId: auth.companyId } });
  try {
    const stored = await storeFiles(auth, doc.id, filesOf(req));
    await audit(auth, "document.created", "ComplianceDocument", doc.id, { type: doc.type, files: stored.length });
    if (stored.length) await audit(auth, "file.uploaded", "ComplianceDocument", doc.id, { files: stored.map((s) => ({ id: s.id, role: s.role, bytes: s.fileSizeBytes })) });
    res.status(201).json(view({ ...doc, attachments: stored }));
  } catch (e) {
    // Validation of a later file failed: undo the whole upload so no half-saved document remains.
    const atts = await prisma.attachment.findMany({ where: { complianceDocumentId: doc.id } });
    await prisma.complianceDocument.delete({ where: { id: doc.id } });
    await deleteStoredObjects(auth.companyId, atts.map((a) => a.storageKey));
    throw e;
  }
});

/** Add more files (e.g. the licence back side) to an existing document. */
router.post("/:id/files", requirePermission("documents:write"), uploadLimiter, upload, async (req, res) => {
  const auth = authOf(req);
  const doc = await loadDoc(auth, parseId(req.params.id), "write");
  const files = filesOf(req);
  if (!Object.values(files).some((f) => f?.length)) throw badRequest("No file was uploaded");
  if (doc.attachments.length + Object.values(files).reduce((n, f) => n + (f?.length ?? 0), 0) > 10) throw badRequest("A document can have at most 10 files");
  const stored = await storeFiles(auth, doc.id, files);
  // New evidence needs a fresh check.
  await prisma.complianceDocument.update({ where: { id: doc.id }, data: { verificationStatus: "PENDING", verifiedAt: null, verifiedById: null, rejectionReason: null } });
  await audit(auth, "file.uploaded", "ComplianceDocument", doc.id, { files: stored.map((s) => ({ id: s.id, role: s.role, bytes: s.fileSizeBytes })) });
  res.status(201).json(stored.map(publicAttachment));
});

router.patch("/:id", requirePermission("documents:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await loadDoc(auth, id, "write");
  const body = parsePatch(DocBody, req);
  const type = body.type ?? existing.type;
  if (!canSeeType(auth, type, "write")) throw badRequest("You do not have permission to manage KYC documents");
  if ("vehicleId" in body || "driverId" in body || "type" in body) {
    await assertOwner(auth.companyId, type, "vehicleId" in body ? body.vehicleId : existing.vehicleId, "driverId" in body ? body.driverId : existing.driverId);
  }
  assertDates("issuedOn" in body ? body.issuedOn : existing.issuedOn, "expiresOn" in body ? body.expiresOn : existing.expiresOn);
  assertMaskedId(type, body.documentNumber ?? existing.documentNumber);
  // A verified document whose substance changes must be verified again.
  const material = ["type", "documentNumber", "issuedOn", "expiresOn", "vehicleId", "driverId"].some((k) => k in body);
  const doc = await prisma.complianceDocument.update({
    where: { id },
    data: { ...body, ...(material ? { verificationStatus: "PENDING" as const, verifiedAt: null, verifiedById: null, rejectionReason: null } : {}) },
    include: { attachments: true },
  });
  await audit(auth, "document.updated", "ComplianceDocument", id, { fields: Object.keys(body), verificationReset: material && existing.verificationStatus !== "PENDING" });
  res.json(view(doc));
});

router.post("/:id/verify", requirePermission("documents:verify"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await loadDoc(auth, id, "read");
  const body = parseBody(
    z.object({ status: z.enum(["VERIFIED", "REJECTED"]), reason: z.string().trim().max(300).optional().nullable() }).refine((b) => b.status !== "REJECTED" || !!b.reason, {
      message: "Give a reason when rejecting a document",
      path: ["reason"],
    }),
    req,
  );
  if (body.status === "VERIFIED" && !existing.storageKey && !existing.attachments.length) throw badRequest("Upload a copy of the document before verifying it");
  const doc = await prisma.complianceDocument.update({
    where: { id },
    data: { verificationStatus: body.status, verifiedAt: new Date(), verifiedById: auth.userId, rejectionReason: body.status === "REJECTED" ? body.reason : null },
    include: { attachments: true },
  });
  await audit(auth, `document.${body.status.toLowerCase()}`, "ComplianceDocument", id, { type: doc.type });
  res.json(view(doc));
});

router.delete("/:id", requirePermission("documents:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await loadDoc(auth, id, "write");
  await prisma.complianceDocument.delete({ where: { id } }); // attachments cascade
  await deleteStoredObjects(auth.companyId, [existing.storageKey, ...existing.attachments.map((a) => a.storageKey)]);
  await audit(auth, "document.deleted", "ComplianceDocument", id, { type: existing.type, files: existing.attachments.length + (existing.storageKey ? 1 : 0) });
  res.status(204).end();
});

/** Authenticated, tenant-checked download of the document's main file. Files are never served statically. */
router.get("/:id/file", requirePermission("documents:read"), async (req, res) => {
  const auth = authOf(req);
  const doc = await loadDoc(auth, parseId(req.params.id), "read");
  const first = doc.attachments[0];
  const key = doc.storageKey ?? first?.storageKey;
  if (!key) throw notFound("Document file");
  const data = await readIfExists(auth.companyId, key);
  if (!data) throw notFound("Document file");
  await audit(auth, "file.downloaded", "ComplianceDocument", doc.id);
  res.setHeader("Content-Type", (doc.storageKey ? doc.fileMimeType : first?.fileMimeType) ?? "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition((doc.storageKey ? doc.fileName : first?.fileName) ?? "document"));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
});

export default router;
