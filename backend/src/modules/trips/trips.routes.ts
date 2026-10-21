import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { simulatePosition } from "./telemetry";
import { createManualTrip, transitionTrip, updateStop } from "./trips.service";

const router = Router();

const TripStatus = z.enum(["PLANNED", "DISPATCHED", "IN_TRANSIT", "COMPLETED", "CANCELLED"]);

router.get("/", requirePermission("trips:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ status: TripStatus.optional() }), req);
  const trips = await prisma.trip.findMany({
    where: { companyId: auth.companyId, status: q.status, ...(auth.role === "DRIVER" ? { driverId: auth.driverId ?? -1 } : {}) },
    include: {
      vehicle: { select: { id: true, registrationNumber: true } },
      driver: { select: { id: true, name: true } },
      _count: { select: { stops: true } },
    },
    orderBy: { plannedStart: "desc" },
    take: 200,
  });
  res.json(trips.map(({ verificationToken: _t, ...t }) => t));
});

router.get("/:id", requirePermission("trips:read"), async (req, res) => {
  const auth = authOf(req);
  const trip = await prisma.trip.findFirst({
    where: { id: parseId(req.params.id), companyId: auth.companyId, ...(auth.role === "DRIVER" ? { driverId: auth.driverId ?? -1 } : {}) },
    include: {
      vehicle: true,
      driver: true,
      stops: { orderBy: { sequence: "asc" }, include: { location: true, order: { select: { id: true, orderNumber: true, customerName: true, weightKg: true, windowEnd: true, status: true } } } },
      events: { orderBy: { createdAt: "asc" } },
      billingDocuments: { select: { id: true, kind: true, number: true, status: true, total: true } },
      optimizationRun: { select: { id: true, name: true, algorithm: true } },
    },
  });
  if (!trip) throw notFound("Trip");
  const position =
    trip.status === "IN_TRANSIT"
      ? simulatePosition(
          trip.stops.map((s) => ({ lat: s.location.lat, lng: s.location.lng, plannedArrival: s.plannedArrival, name: s.location.name })),
          trip.plannedStart,
          trip.actualStart,
        )
      : null;
  res.json({ ...trip, simulatedPosition: position });
});

const CreateTrip = z.object({
  vehicleId: z.coerce.number().int().positive(),
  driverId: z.coerce.number().int().positive(),
  orderIds: z.array(z.coerce.number().int().positive()).min(1).max(30),
  plannedStart: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

router.post("/", requirePermission("trips:write"), async (req, res) => {
  const auth = authOf(req);
  const trip = await createManualTrip(auth, parseBody(CreateTrip, req));
  res.status(201).json(trip);
});

router.post("/:id/status", requirePermission("trips:progress"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(z.object({ status: TripStatus, note: z.string().trim().max(500).optional().nullable() }), req);
  const id = parseId(req.params.id);
  await transitionTrip(auth, id, body.status, body.note);
  res.json({ ok: true });
});

router.post("/:id/stops/:stopId", requirePermission("trips:progress"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(z.object({ action: z.enum(["ARRIVE", "COMPLETE", "SKIP"]) }), req);
  await updateStop(auth, parseId(req.params.id), parseId(req.params.stopId, "stopId"), body.action);
  res.json({ ok: true });
});

router.get("/:id/qr", requirePermission("trips:read"), async (req, res) => {
  const auth = authOf(req);
  const trip = await prisma.trip.findFirst({
    where: { id: parseId(req.params.id), companyId: auth.companyId, ...(auth.role === "DRIVER" ? { driverId: auth.driverId ?? -1 } : {}) },
  });
  if (!trip) throw notFound("Trip");
  const url = `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/verify/${trip.verificationToken}`;
  res.json({ url, dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 280 }) });
});

export default router;
