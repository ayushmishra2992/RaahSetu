import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parsePatch, parseQuery, zOptionalDate } from "../../lib/validate";
import { can } from "../../lib/permissions";
import { requirePermission, type AuthContext } from "../../middleware/auth";
import { deleteStoredObjects, publicAttachment } from "../attachments/attachments.service";
import { getCompanySettings } from "../company/settings";
import { redactCompliance } from "../compliance/compliance";
import { driverCompliance, visibilityFor } from "../compliance/compliance.service";

const router = Router();

const DriverBody = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[+0-9 -]{7,20}$/, "Enter a valid phone number"),
  licenseNumber: z.string().trim().toUpperCase().min(5).max(30),
  licenseExpiry: z.coerce.date(),
  status: z.enum(["AVAILABLE", "ON_TRIP", "OFF_DUTY", "INACTIVE"]).optional(),
  maxShiftHours: z.coerce.number().min(1).max(16).default(10),
  userId: z.coerce.number().int().positive().optional().nullable(),
  licenseClass: z.string().trim().toUpperCase().max(60).optional().nullable(),
  licenseIssuedOn: zOptionalDate,
});

/**
 * Privacy-first KYC: only the ID kind and its LAST 4 characters are stored (never a
 * full Aadhaar/ID number), together with when and by whom consent was recorded.
 * Readable and writable only with the kyc:* permissions (admins and managers).
 */
const KycBody = z.object({
  consent: z.literal(true, { message: "Record the driver's consent before saving KYC details" }),
  idType: z.enum(["AADHAAR", "PAN", "VOTER_ID", "PASSPORT", "OTHER"]).optional().nullable(),
  idLast4: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}$/, "Enter only the last 4 characters of the ID (never the full number)")
    .optional()
    .nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  emergencyContactName: z.string().trim().max(120).optional().nullable(),
  emergencyContactPhone: z
    .string()
    .trim()
    .regex(/^[+0-9 -]{7,20}$/, "Enter a valid phone number")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
});

const KYC_FIELDS = ["address", "emergencyContactName", "emergencyContactPhone", "kycIdType", "kycIdLast4", "kycConsentAt", "kycConsentById", "kycVerification"] as const;

/** Removes personal/KYC fields for callers without kyc:read. */
function forRole<T extends object>(auth: AuthContext, driver: T): T {
  if (can(auth.role, "kyc:read")) return driver;
  const copy = { ...driver } as Record<string, unknown>;
  for (const k of KYC_FIELDS) delete copy[k];
  copy.kycOnFile = !!(driver as { kycConsentAt?: unknown }).kycConsentAt;
  return copy as T;
}

function assertLicenceDates(issuedOn: Date | null | undefined, expiry: Date) {
  if (issuedOn && expiry < issuedOn) throw badRequest("Licence expiry cannot be before its issue date");
}

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
  const drivers = await prisma.driver.findMany({
    where: { companyId: auth.companyId, status: q.status },
    include: { user: { select: { id: true, email: true } } },
    orderBy: { name: "asc" },
  });
  res.json(drivers.map((d) => forRole(auth, d)));
});

router.get("/:id", requirePermission("fleet:read"), async (req, res) => {
  const auth = authOf(req);
  const driver = await prisma.driver.findFirst({
    where: { id: parseId(req.params.id), companyId: auth.companyId },
    include: {
      user: { select: { id: true, email: true } },
      documents: { orderBy: { expiresOn: "asc" }, include: { attachments: true } },
      trips: { orderBy: { plannedStart: "desc" }, take: 10, include: { vehicle: { select: { id: true, registrationNumber: true } } } },
    },
  });
  if (!driver) throw notFound("Driver");
  const settings = await getCompanySettings(auth.companyId);
  const kyc = can(auth.role, "kyc:read");
  res.json(
    forRole(auth, {
      ...driver,
      documents: driver.documents
        .filter((d) => kyc || d.type !== "KYC_ID")
        .map(({ storageKey, attachments, ...d }) => ({ ...d, hasFile: !!storageKey || attachments.length > 0, attachments: attachments.map(publicAttachment) })),
      compliance: redactCompliance(driverCompliance(driver, settings), visibilityFor(auth.role)),
    }),
  );
});

router.post("/", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(DriverBody, req);
  await assertDriverUser(auth.companyId, body.userId);
  assertLicenceDates(body.licenseIssuedOn, body.licenseExpiry);
  const driver = await prisma.driver.create({ data: { ...body, companyId: auth.companyId } });
  await audit(auth, "driver.created", "Driver", driver.id, { name: driver.name });
  res.status(201).json(forRole(auth, driver));
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
  assertLicenceDates("licenseIssuedOn" in body ? body.licenseIssuedOn : existing.licenseIssuedOn, body.licenseExpiry ?? existing.licenseExpiry);
  const driver = await prisma.driver.update({ where: { id }, data: body });
  await audit(auth, "driver.updated", "Driver", id, { fields: Object.keys(body) });
  res.json(forRole(auth, driver));
});

router.put("/:id/kyc", requirePermission("kyc:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.driver.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Driver");
  const body = parseBody(KycBody, req);
  const idChanged = (body.idType ?? null) !== existing.kycIdType || (body.idLast4 ?? null) !== existing.kycIdLast4;
  const driver = await prisma.driver.update({
    where: { id },
    data: {
      kycIdType: body.idType ?? null,
      kycIdLast4: body.idLast4 ?? null,
      address: body.address ?? null,
      emergencyContactName: body.emergencyContactName ?? null,
      emergencyContactPhone: body.emergencyContactPhone ?? null,
      kycConsentAt: new Date(),
      kycConsentById: auth.userId,
      ...(idChanged ? { kycVerification: "PENDING" as const } : {}),
    },
  });
  // Never log the identifiers themselves, only that they changed.
  await audit(auth, "driver.kyc_updated", "Driver", id, { idType: body.idType ?? null, idChanged, consentRecorded: true });
  res.json(forRole(auth, driver));
});

router.post("/:id/kyc/verify", requirePermission("kyc:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.driver.findFirst({ where: { id, companyId: auth.companyId } });
  if (!existing) throw notFound("Driver");
  const body = parseBody(z.object({ status: z.enum(["VERIFIED", "REJECTED", "PENDING"]) }), req);
  if (body.status === "VERIFIED" && !existing.kycConsentAt) throw badRequest("Record KYC details and consent before verifying");
  const driver = await prisma.driver.update({ where: { id }, data: { kycVerification: body.status } });
  await audit(auth, `driver.kyc_${body.status.toLowerCase()}`, "Driver", id);
  res.json(forRole(auth, driver));
});

router.delete("/:id", requirePermission("fleet:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await prisma.driver.findFirst({ where: { id, companyId: auth.companyId }, include: { _count: { select: { trips: true } } } });
  if (!existing) throw notFound("Driver");
  if (existing._count.trips > 0) throw conflict("Driver has trip history; set status to INACTIVE instead of deleting");
  const docs = await prisma.complianceDocument.findMany({ where: { driverId: id, companyId: auth.companyId }, select: { storageKey: true, attachments: { select: { storageKey: true } } } });
  await prisma.driver.delete({ where: { id } }); // documents and attachments cascade
  await deleteStoredObjects(auth.companyId, docs.flatMap((d) => [d.storageKey, ...d.attachments.map((a) => a.storageKey)]));
  await audit(auth, "driver.deleted", "Driver", id, { name: existing.name });
  res.status(204).end();
});

export default router;
