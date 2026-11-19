import { Router, type Request } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { can } from "../../lib/permissions";
import { uploadLimiter } from "../../lib/rateLimits";
import { authOf } from "../../lib/http";
import { assertAllowedFile, readIfExists, safeFileName, sha256, storage } from "../../lib/storage";
import { storageKey } from "../../lib/tokens";
import { verificationToken } from "../../lib/tokens";
import { parseBody, parseId, parsePatch, parseQuery } from "../../lib/validate";
import { requirePermission, type AuthContext } from "../../middleware/auth";
import { deleteStoredObjects, publicAttachment, storeAttachment, uploadFiles } from "../attachments/attachments.service";
import { applyStopAction } from "../trips/trips.service";
import { podPdf } from "./pdfs";
import { issuerOf, loadTripFor, placeOf, sendPdf, zOptNumber, zText } from "./shipments.common";

const router = Router();

/** PDFKit embeds PNG/JPEG only, and phone captures are converted to JPEG client-side. */
const POD_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
const DELIVERED_LIKE = ["DELIVERED", "PARTIALLY_DELIVERED", "DISPUTED"] as const;
const NOT_DELIVERED = ["FAILED", "RETURNED"] as const;
const isDeliveredLike = (s: string) => (DELIVERED_LIKE as readonly string[]).includes(s);

const PodBody = z.object({
  tripId: z.coerce.number().int().positive(),
  tripStopId: z.coerce.number().int().positive(),
  status: z.enum([...DELIVERED_LIKE, ...NOT_DELIVERED]),
  receiverName: z.string().trim().min(2).max(120),
  receiverPhone: z
    .string()
    .trim()
    .regex(/^[+0-9 -]{7,20}$/, "Enter a valid phone number")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  deliveredAt: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.date().optional()),
  deliveredQuantity: zOptNumber(1e7),
  shortageDetails: zText(1000),
  damageDetails: zText(1000),
  remarks: zText(1000),
});

const upload = uploadFiles(6).fields([
  { name: "signature", maxCount: 1 },
  { name: "photos", maxCount: 5 },
]);
type Files = { signature?: Express.Multer.File[]; photos?: Express.Multer.File[] };
const filesOf = (req: Request) => (req.files ?? {}) as Files;

const include = {
  attachments: true,
  order: { select: { id: true, orderNumber: true, customerName: true, weightKg: true } },
  tripStop: { select: { id: true, sequence: true, status: true, location: { select: { name: true, city: true, state: true } } } },
  trip: { select: { id: true, tripNumber: true, driverId: true, status: true } },
} as const;
type Row = Awaited<ReturnType<typeof prisma.proofOfDelivery.findFirstOrThrow<{ include: typeof include }>>>;
const view = ({ verificationToken: _t, ...p }: Row) => ({ ...p, attachments: p.attachments.map(publicAttachment) });

/** Business rules shared by create and update. */
function assertConsistent(status: string, ordered: number | null, qty: number | null | undefined, shortage?: string | null, damage?: string | null, remarks?: string | null) {
  if (status === "PARTIALLY_DELIVERED") {
    if (qty === null || qty === undefined) throw badRequest("Enter the delivered quantity for a partial delivery");
    if (ordered !== null && qty >= ordered) throw badRequest(`A partial delivery must be less than the ordered ${ordered} kg`);
    if (!shortage && !damage) throw badRequest("Describe the shortage or damage for a partial delivery");
  }
  if (status === "DELIVERED" && qty != null && ordered !== null && qty > ordered) throw badRequest(`Delivered quantity cannot exceed the ordered ${ordered} kg`);
  if ((status === "FAILED" || status === "RETURNED") && qty) throw badRequest("A failed or returned delivery cannot have a delivered quantity");
  if ((status === "FAILED" || status === "RETURNED" || status === "DISPUTED") && !remarks) throw badRequest(`Add remarks explaining why the delivery is ${status.toLowerCase().replace("_", " ")}`);
}

async function loadPod(auth: AuthContext, id: number) {
  const p = await prisma.proofOfDelivery.findFirst({ where: { id, companyId: auth.companyId }, include });
  if (!p) throw notFound("Proof of delivery");
  if (auth.role === "DRIVER" && p.trip.driverId !== auth.driverId) throw notFound("Proof of delivery");
  return p;
}

router.get("/", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ tripId: z.coerce.number().int().positive().optional(), orderId: z.coerce.number().int().positive().optional() }), req);
  const rows = await prisma.proofOfDelivery.findMany({
    where: { companyId: auth.companyId, tripId: q.tripId, orderId: q.orderId, ...(auth.role === "DRIVER" ? { trip: { driverId: auth.driverId ?? -1 } } : {}) },
    include,
    orderBy: { deliveredAt: "desc" },
    take: 500,
  });
  res.json(rows.map(view));
});

router.get("/:id", requirePermission("shipments:read"), async (req, res) => {
  res.json(view(await loadPod(authOf(req), parseId(req.params.id))));
});

/** Integration-test hook: simulates a failure after the stop update (rollback tests). Inert unless NODE_ENV=test. */
export const podTestHooks: { failAfterStopUpdate?: boolean } = {};

router.post("/", requirePermission("pod:write"), uploadLimiter, upload, async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(PodBody, req);
  const files = filesOf(req);
  const trip = await loadTripFor(auth, body.tripId);
  if (auth.role === "DRIVER" && trip.driverId !== auth.driverId) throw notFound("Trip");
  // Early, cheap rejection before any file is stored (re-checked under the trip lock below).
  if (trip.status === "CANCELLED") throw conflict("This trip is cancelled; proof of delivery can no longer be recorded");
  if (trip.status !== "IN_TRANSIT" && trip.status !== "COMPLETED") throw conflict("Proof of delivery can be recorded once the trip is in transit");
  const stop = await prisma.tripStop.findFirst({ where: { id: body.tripStopId, tripId: trip.id }, include: { order: true } });
  if (!stop) throw notFound("Stop");
  if (stop.type !== "DROP") throw badRequest("Proof of delivery is recorded at delivery (drop) stops");
  await assertNoPod(stop.id);

  // 1. Validate everything before any write.
  const signature = files.signature?.[0];
  if (isDeliveredLike(body.status) && !signature) throw badRequest("Capture the receiver's signature");
  const uploads = [...(signature ? [{ file: signature, role: "SIGNATURE" as const }] : []), ...(files.photos ?? []).map((file) => ({ file, role: "PHOTO" as const }))];
  for (const u of uploads) assertAllowedFile(u.file.mimetype, u.file.buffer, u.file.originalname, POD_IMAGE_TYPES);
  assertConsistent(body.status, stop.order?.weightKg ?? null, body.deliveredQuantity, body.shortageDetails, body.damageDetails, body.remarks);
  const deliveredAt = body.deliveredAt ?? new Date();
  if (deliveredAt.getTime() > Date.now() + 5 * 60_000) throw badRequest("Delivery time cannot be in the future");
  const wantDone = isDeliveredLike(body.status);

  // 2. Store the files under fresh random keys (object storage cannot join a DB transaction).
  const stored: Array<{ key: string; role: "SIGNATURE" | "PHOTO"; file: Express.Multer.File }> = [];
  try {
    for (const u of uploads) {
      const key = storageKey();
      await storage.put(auth.companyId, key, u.file.buffer, u.file.mimetype);
      stored.push({ key, role: u.role, file: u.file });
    }
  } catch (e) {
    await deleteStoredObjects(auth.companyId, stored.map((x) => x.key));
    throw e;
  }

  // 3. One transaction: stop outcome + order status + POD + attachment rows, or nothing.
  let podId: number;
  try {
    podId = await prisma.$transaction(async (tx) => {
      // 1. Take the trip lock FIRST. Stop updates, trip transitions (incl. cancel) and
      //    other POD submissions for this trip all take the same lock, so everything
      //    below is read and decided on a stable state.
      const [locked] = await tx.$queryRaw<Array<{ status: string; driverId: number }>>`SELECT status, "driverId" FROM "Trip" WHERE id = ${trip.id} AND "companyId" = ${auth.companyId} FOR UPDATE`;
      if (!locked) throw notFound("Trip");
      if (auth.role === "DRIVER" && locked.driverId !== auth.driverId) throw notFound("Trip");
      // 2. A duplicate (another tab, a retry after a lost response, a double tap) now
      //    always sees the first POD and gets the same 409 naming it.
      await assertNoPod(stop.id, tx);
      // 3. Eligibility on the locked state: a trip cancelled meanwhile takes no POD.
      if (locked.status !== "IN_TRANSIT" && locked.status !== "COMPLETED") throw conflict(`This trip is ${locked.status.toLowerCase()}; proof of delivery can no longer be recorded`);
      const fresh = await tx.tripStop.findUniqueOrThrow({ where: { id: stop.id } });
      if (fresh.status === "PENDING" || fresh.status === "ARRIVED") {
        await applyStopAction(tx, auth, trip.id, stop.id, wantDone ? "COMPLETE" : "SKIP"); // re-locks the same row (no-op) and re-validates
      } else {
        if (wantDone && fresh.status !== "COMPLETED") throw conflict(`This stop was ${fresh.status.toLowerCase()}, so it cannot be recorded as ${body.status.toLowerCase().replace("_", " ")}`);
        if (!wantDone && fresh.status !== "SKIPPED") throw conflict("This stop is already completed; record the problem as a disputed delivery instead");
      }
      if (podTestHooks.failAfterStopUpdate && env.NODE_ENV === "test") throw new Error("Simulated failure after the stop update");
      const pod = await tx.proofOfDelivery.create({
        data: {
          companyId: auth.companyId,
          tripId: trip.id,
          tripStopId: stop.id,
          orderId: stop.orderId,
          status: body.status,
          receiverName: body.receiverName,
          receiverPhone: body.receiverPhone ?? null,
          deliveredAt,
          deliveredQuantity: body.deliveredQuantity ?? (body.status === "DELIVERED" ? (stop.order?.weightKg ?? null) : null),
          shortageDetails: body.shortageDetails ?? null,
          damageDetails: body.damageDetails ?? null,
          remarks: body.remarks ?? null,
          recordedById: auth.userId,
          verificationToken: verificationToken(),
        },
      });
      for (const x of stored) {
        await tx.attachment.create({
          data: {
            companyId: auth.companyId,
            podId: pod.id,
            role: x.role,
            fileName: safeFileName(x.file.originalname, x.role.toLowerCase()),
            fileMimeType: x.file.mimetype,
            fileSizeBytes: x.file.size,
            storageKey: x.key,
            sha256: sha256(x.file.buffer),
            uploadedById: auth.userId,
          },
        });
      }
      await audit(auth, "pod.recorded", "ProofOfDelivery", pod.id, { tripId: trip.id, stopId: stop.id, orderId: stop.orderId, status: body.status, photos: files.photos?.length ?? 0, signed: !!signature }, tx);
      return pod.id;
    });
  } catch (e) {
    // Nothing was committed: remove the files stored in step 2 so no orphans remain.
    await deleteStoredObjects(auth.companyId, stored.map((x) => x.key));
    // A concurrent duplicate that slipped past the pre-check hits the unique tripStopId.
    if ((e as { code?: string }).code === "P2002") await assertNoPod(stop.id);
    throw e;
  }
  res.status(201).json(view(await loadPod(auth, podId)));
});

/** 409 naming the existing POD, so a client retrying after a lost response can recognise its own record. */
async function assertNoPod(tripStopId: number, db: Pick<typeof prisma, "proofOfDelivery"> = prisma) {
  const existing = await db.proofOfDelivery.findUnique({ where: { tripStopId }, select: { id: true, status: true } });
  if (existing) throw new AppError(409, "A proof of delivery already exists for this stop; edit it instead", "POD_EXISTS", { podId: existing.id, status: existing.status });
}

router.patch("/:id", requirePermission("pod:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const existing = await loadPod(auth, id);
  const body = parsePatch(PodBody.omit({ tripId: true, tripStopId: true }), req);
  const statusChange = body.status !== undefined && body.status !== existing.status;
  // Edit rules (enforced here, not in the UI):
  // - Drivers may correct their own POD only while the trip is in transit, may not
  //   change its outcome, and may not touch a disputed POD.
  // - Moving a POD out of DISPUTED (resolving the dispute) needs pod:resolve
  //   (admins/managers) and remarks explaining the resolution.
  if (auth.role === "DRIVER") {
    if (existing.trip.status !== "IN_TRANSIT") throw forbidden("The trip is no longer in transit; ask the office to correct this proof of delivery");
    if (existing.status === "DISPUTED") throw forbidden("A disputed delivery can only be changed by a manager");
    if (statusChange) throw forbidden("Drivers cannot change the outcome of a recorded delivery; ask the office");
  }
  if (statusChange && existing.status === "DISPUTED") {
    if (!can(auth.role, "pod:resolve")) throw forbidden("Only an admin or manager can resolve a disputed delivery");
    if (!body.remarks) throw badRequest("Add remarks explaining how the dispute was resolved");
  }
  if (body.deliveredAt && body.deliveredAt.getTime() > Date.now() + 5 * 60_000) throw badRequest("Delivery time cannot be in the future");
  if (body.status && isDeliveredLike(body.status) !== isDeliveredLike(existing.status)) {
    throw conflict("Changing between delivered and not-delivered changes the stop outcome; cancel and re-plan the order instead");
  }
  const next = { ...existing, ...body };
  assertConsistent(next.status, existing.order?.weightKg ?? null, next.deliveredQuantity, next.shortageDetails, next.damageDetails, next.remarks);
  await prisma.proofOfDelivery.update({ where: { id }, data: body });
  // Keep the before/after of what changed in the audit trail (no files, no phone numbers).
  const changes = Object.fromEntries(Object.keys(body).filter((k) => k !== "receiverPhone").map((k) => [k, { from: (existing as Record<string, unknown>)[k] ?? null, to: (body as Record<string, unknown>)[k] ?? null }]));
  await audit(auth, "pod.updated", "ProofOfDelivery", id, { changes, phoneChanged: "receiverPhone" in body });
  res.json(view(await loadPod(auth, id)));
});

/** Add delivery photographs later (the signature is captured once and never replaced). */
router.post("/:id/photos", requirePermission("pod:write"), uploadLimiter, upload, async (req, res) => {
  const auth = authOf(req);
  const pod = await loadPod(auth, parseId(req.params.id));
  const photos = filesOf(req).photos ?? [];
  if (!photos.length) throw badRequest("No photo was uploaded");
  if (pod.attachments.filter((a) => a.role === "PHOTO").length + photos.length > 8) throw badRequest("A proof of delivery can have at most 8 photos");
  for (const p of photos) assertAllowedFile(p.mimetype, p.buffer, p.originalname, POD_IMAGE_TYPES);
  const stored = [];
  for (const p of photos) stored.push(await storeAttachment(auth, p, { podId: pod.id }, "PHOTO", POD_IMAGE_TYPES));
  await audit(auth, "pod.photos_added", "ProofOfDelivery", pod.id, { count: stored.length });
  res.status(201).json(stored.map(publicAttachment));
});

export async function podPdfFor(companyId: number, id: number) {
  const p = await prisma.proofOfDelivery.findFirst({
    where: { id, companyId },
    include: {
      attachments: true,
      order: { select: { orderNumber: true, customerName: true, weightKg: true } },
      tripStop: { include: { location: true } },
      trip: { include: { vehicle: { select: { registrationNumber: true, type: true } }, driver: { select: { name: true, phone: true, licenseNumber: true } } } },
    },
  });
  if (!p) throw notFound("Proof of delivery");
  const read = (key: string) => readIfExists(companyId, key);
  const sig = p.attachments.find((a) => a.role === "SIGNATURE");
  const photos = (await Promise.all(p.attachments.filter((a) => a.role === "PHOTO").map((a) => read(a.storageKey)))).filter((b): b is Buffer => !!b);
  const pdf = await podPdf({
    ...p,
    orderNumber: p.order?.orderNumber ?? null,
    customerName: p.order?.customerName ?? null,
    orderedQuantity: p.order?.weightKg ?? null,
    dropLocation: placeOf(p.tripStop.location),
    issuer: await issuerOf(companyId),
    trip: p.trip,
    signature: sig ? await read(sig.storageKey) : null,
    photos,
    recordedAt: p.createdAt,
  });
  return { pdf, fileName: `POD-${p.order?.orderNumber ?? p.trip.tripNumber}.pdf` };
}

router.get("/:id/pdf", requirePermission("shipments:read"), async (req, res) => {
  const auth = authOf(req);
  const pod = await loadPod(auth, parseId(req.params.id));
  const { pdf, fileName } = await podPdfFor(auth.companyId, pod.id);
  await audit(auth, "pod.pdf_downloaded", "ProofOfDelivery", pod.id);
  sendPdf(res, pdf, fileName, req.query.inline === "1");
});

export default router;
