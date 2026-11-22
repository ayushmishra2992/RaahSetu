import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { contentDisposition, readIfExists, verifyFileToken } from "../../lib/storage";
import { parseId } from "../../lib/validate";
import { deleteStoredObjects, issueDownloadUrl, loadAttachmentFor } from "./attachments.service";

/** Authenticated attachment operations (mounted under the authenticated /api router). */
export const attachmentRoutes = Router();

/** Short-lived signed link (works for both local and S3 storage). */
attachmentRoutes.get("/:id/url", async (req, res) => {
  const auth = authOf(req);
  const a = await loadAttachmentFor(auth, parseId(req.params.id), "read");
  res.json(await issueDownloadUrl(auth, a));
});

/** Direct authenticated download (used for in-app previews). */
attachmentRoutes.get("/:id", async (req, res) => {
  const auth = authOf(req);
  const a = await loadAttachmentFor(auth, parseId(req.params.id), "read");
  const data = await readIfExists(auth.companyId, a.storageKey);
  if (!data) throw notFound("File content (storage was reset or the object is missing)");
  await audit(auth, "file.downloaded", "Attachment", a.id);
  res.setHeader("Content-Type", a.fileMimeType);
  res.setHeader("Content-Disposition", req.query.inline === "1" ? "inline" : contentDisposition(a.fileName));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
});

attachmentRoutes.delete("/:id", async (req, res) => {
  const auth = authOf(req);
  const a = await loadAttachmentFor(auth, parseId(req.params.id), "write");
  await prisma.$transaction(async (tx) => {
    // The receiver's signature is the POD's core evidence: captured once, never replaced or removed (any role).
    if (a.role === "SIGNATURE") throw conflict("A delivery signature is never removed");
    if (a.ewayBillId) {
      // A cancelled E-Way Bill record is frozen (edits and uploads are already refused). The row lock
      // serialises this check with a concurrent cancellation, which takes the same lock.
      const [row] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "EwayBill" WHERE id = ${a.ewayBillId} AND "companyId" = ${auth.companyId} FOR UPDATE`;
      if (!row || row.status !== "ACTIVE") throw conflict("Files of a cancelled E-Way Bill record cannot be deleted");
    }
    const { count } = await tx.attachment.deleteMany({ where: { id: a.id, companyId: auth.companyId } });
    if (!count) throw notFound("File");
    await audit(auth, "file.deleted", "Attachment", a.id, { role: a.role }, tx);
  });
  // The object is removed only after the row deletion has committed.
  await deleteStoredObjects(auth.companyId, [a.storageKey]);
  res.status(204).end();
});

/**
 * PUBLIC: redeems a signed link minted above. The token is an HMAC over
 * (company, key, name, type, expiry), so it cannot be forged or extended, and it
 * only ever resolves inside its own company's storage prefix.
 */
export const signedFileRoutes = Router();
signedFileRoutes.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
signedFileRoutes.get("/:token", async (req, res) => {
  const p = verifyFileToken(String(req.params.token));
  if (!p) throw notFound("Link (it may have expired — request a new one)");
  const data = await readIfExists(p.c, p.k);
  if (!data) throw notFound("File");
  res.setHeader("Content-Type", p.m);
  res.setHeader("Content-Disposition", contentDisposition(p.n));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.send(data);
});
