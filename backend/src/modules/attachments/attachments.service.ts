import multer from "multer";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import type { AttachmentRole } from "../../generated/prisma/enums";
import { audit } from "../../lib/audit";
import { forbidden, notFound } from "../../lib/errors";
import { can } from "../../lib/permissions";
import { assertAllowedFile, safeFileName, sha256, signedDownloadUrl, storage } from "../../lib/storage";
import { storageKey } from "../../lib/tokens";
import type { AuthContext } from "../../middleware/auth";

/** Shared multer config: memory only (nothing touches disk before validation), bounded size and count. */
export const uploadFiles = (maxFiles: number) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: maxFiles, fields: 60 } });

export type AttachmentOwner = { complianceDocumentId: number } | { ewayBillId: number } | { podId: number };

/** Validate, store and record one uploaded file. Removes the stored object if the DB write fails. */
export async function storeAttachment(
  auth: AuthContext,
  file: Express.Multer.File,
  owner: AttachmentOwner,
  role: AttachmentRole,
  allowedMime?: readonly string[],
  tx: Pick<typeof prisma, "attachment"> = prisma,
) {
  assertAllowedFile(file.mimetype, file.buffer, file.originalname, allowedMime);
  const key = storageKey();
  await storage.put(auth.companyId, key, file.buffer, file.mimetype);
  try {
    const a = await tx.attachment.create({
      data: {
        companyId: auth.companyId,
        role,
        fileName: safeFileName(file.originalname, role.toLowerCase()),
        fileMimeType: file.mimetype,
        fileSizeBytes: file.size,
        storageKey: key,
        sha256: sha256(file.buffer),
        uploadedById: auth.userId,
        ...owner,
      },
    });
    return a;
  } catch (e) {
    await storage.delete(auth.companyId, key);
    throw e;
  }
}

/** Delete stored objects after their rows are gone (best effort; never throws). */
export async function deleteStoredObjects(companyId: number, keys: Array<string | null | undefined>) {
  await Promise.all(keys.filter((k): k is string => !!k).map((k) => storage.delete(companyId, k)));
}

/** Public view of an attachment row: never exposes the storage key. */
export function publicAttachment(a: { id: number; role: string; fileName: string; fileMimeType: string; fileSizeBytes: number; sha256: string; createdAt: Date }) {
  return { id: a.id, role: a.role, fileName: a.fileName, fileMimeType: a.fileMimeType, fileSizeBytes: a.fileSizeBytes, sha256: a.sha256, createdAt: a.createdAt };
}

// ───────────────────────── Access control ─────────────────────────

/** Orders a driver may see: those on trips assigned to them. */
export async function driverCanAccessOrder(auth: AuthContext, orderId: number) {
  if (!auth.driverId) return false;
  const n = await prisma.tripStop.count({ where: { orderId, trip: { companyId: auth.companyId, driverId: auth.driverId } } });
  return n > 0;
}

export async function driverCanAccessTrip(auth: AuthContext, tripId: number) {
  if (!auth.driverId) return false;
  return (await prisma.trip.count({ where: { id: tripId, companyId: auth.companyId, driverId: auth.driverId } })) > 0;
}

type Mode = "read" | "write";

/**
 * Loads an attachment of the caller's company and checks the caller may read or
 * change it, based on what it belongs to. Returns 404 (not 403) for anything the
 * caller cannot see, so ids of other tenants' or other drivers' files never leak.
 */
export async function loadAttachmentFor(auth: AuthContext, id: number, mode: Mode) {
  const a = await prisma.attachment.findFirst({
    where: { id, companyId: auth.companyId },
    include: { complianceDocument: { select: { type: true } }, ewayBill: { select: { orderId: true } }, pod: { select: { tripId: true } } },
  });
  if (!a) throw notFound("File");
  if (a.complianceDocumentId) {
    if (!can(auth.role, mode === "read" ? "documents:read" : "documents:write")) throw notFound("File");
    // KYC identity proofs additionally need the KYC permission (same rule as the documents API).
    if (a.complianceDocument?.type === "KYC_ID" && !can(auth.role, mode === "read" ? "kyc:read" : "kyc:write")) throw notFound("File");
  } else if (a.ewayBillId) {
    if (!can(auth.role, mode === "read" ? "shipments:read" : "shipments:write")) throw notFound("File");
    if (auth.role === "DRIVER" && !(await driverCanAccessOrder(auth, a.ewayBill!.orderId))) throw notFound("File");
  } else if (a.podId) {
    if (!can(auth.role, mode === "read" ? "shipments:read" : "pod:write")) throw notFound("File");
    if (auth.role === "DRIVER" && !(await driverCanAccessTrip(auth, a.pod!.tripId))) throw notFound("File");
  } else {
    throw notFound("File");
  }
  return a;
}

export async function issueDownloadUrl(auth: AuthContext, a: { id: number; storageKey: string; fileName: string; fileMimeType: string }) {
  const link = await signedDownloadUrl(auth.companyId, a.storageKey, a.fileName, a.fileMimeType);
  await audit(auth, "file.download_link_issued", "Attachment", a.id);
  return link;
}

export function assertCan(auth: AuthContext, permission: Parameters<typeof can>[1]) {
  if (!can(auth.role, permission)) throw forbidden();
}
