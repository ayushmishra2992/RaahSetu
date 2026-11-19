import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../../config/prisma";
import { notFound } from "../../lib/errors";

/**
 * PUBLIC endpoint behind QR codes. Returns only what a checkpoint or customer
 * needs to confirm authenticity — no internal ids, no contact details.
 * This verifies records in RaahSetu only; it is NOT a government (e-way bill,
 * VAHAN, GSTN) verification.
 */
const router = Router();

router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));

router.get("/:token", async (req, res) => {
  const token = String(req.params.token);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound("Verification record");
  const doc = await prisma.billingDocument.findUnique({ where: { verificationToken: token }, include: { company: { select: { name: true, gstNumber: true } } } });
  if (doc) {
    res.json({
      // Only documents that were actually issued are genuine; a DRAFT can still
      // be edited freely, so it must never verify as valid.
      valid: doc.status === "ISSUED" || doc.status === "PAID",
      type: doc.kind,
      number: doc.number,
      status: doc.status,
      issuer: doc.company.name,
      issuerGstin: doc.company.gstNumber,
      customerName: doc.customerName,
      total: doc.kind === "INVOICE" ? doc.total : null,
      issuedAt: doc.issuedAt,
      createdAt: doc.createdAt,
      disclaimer: "Verified against RaahSetu records only. This is not a government e-invoice or e-way bill verification.",
    });
    return;
  }
  const trip = await prisma.trip.findUnique({
    where: { verificationToken: token },
    include: { company: { select: { name: true } }, vehicle: { select: { registrationNumber: true } }, driver: { select: { name: true } }, _count: { select: { stops: true } } },
  });
  if (trip) {
    res.json({
      valid: trip.status !== "CANCELLED",
      type: "TRIP",
      number: trip.tripNumber,
      status: trip.status,
      issuer: trip.company.name,
      vehicleRegistration: trip.vehicle.registrationNumber,
      driverName: trip.driver.name.split(" ")[0],
      plannedStart: trip.plannedStart,
      stops: trip._count.stops,
      disclaimer: "Verified against RaahSetu records only. This is not a government e-way bill or VAHAN verification.",
    });
    return;
  }
  const pod = await prisma.proofOfDelivery.findUnique({
    where: { verificationToken: token },
    include: { company: { select: { name: true } }, order: { select: { orderNumber: true } }, trip: { select: { tripNumber: true, vehicle: { select: { registrationNumber: true } } } } },
  });
  if (pod) {
    res.json({
      valid: true,
      type: "PROOF_OF_DELIVERY",
      number: pod.order?.orderNumber ?? pod.trip.tripNumber,
      status: pod.status,
      issuer: pod.company.name,
      tripNumber: pod.trip.tripNumber,
      vehicleRegistration: pod.trip.vehicle.registrationNumber,
      // First name only: enough to match the paper copy, without publishing personal data.
      receivedBy: pod.receiverName.split(" ")[0],
      deliveredAt: pod.deliveredAt,
      disclaimer: "Verified against RaahSetu records only.",
    });
    return;
  }
  throw notFound("Verification record");
});

export default router;
