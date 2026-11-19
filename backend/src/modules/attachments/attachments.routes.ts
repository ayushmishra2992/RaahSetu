import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
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
  await prisma.attachment.delete({ where: { id: a.id } });
  await deleteStoredObjects(auth.companyId, [a.storageKey]);
  await audit(auth, "file.deleted", "Attachment", a.id, { role: a.role });
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
