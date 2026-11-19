import { z } from "zod";
import { prisma } from "../../config/prisma";
import { badRequest, notFound } from "../../lib/errors";
import type { AuthContext } from "../../middleware/auth";
import { driverCanAccessOrder, driverCanAccessTrip } from "../attachments/attachments.service";

/**
 * GSTIN: 2-digit state code, 10-character PAN, entity number, "Z", checksum.
 * (Structure only — RaahSetu does not query the GST portal.)
 */
export const zGstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN (e.g. 06AABCU9603R1ZX)")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

export const zText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v));

/** Multipart forms send numbers as strings; empty string means "not given". */
export const zOptNumber = (max: number) => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().nonnegative().max(max).nullable().optional());

export async function loadOrderFor(auth: AuthContext, orderId: number) {
  const order = await prisma.order.findFirst({ where: { id: orderId, companyId: auth.companyId }, include: { pickupLocation: true, dropLocation: true } });
  if (!order) throw notFound("Order");
  if (auth.role === "DRIVER" && !(await driverCanAccessOrder(auth, orderId))) throw notFound("Order");
  return order;
}

export async function loadTripFor(auth: AuthContext, tripId: number) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, companyId: auth.companyId } });
  if (!trip) throw notFound("Trip");
  if (auth.role === "DRIVER" && !(await driverCanAccessTrip(auth, tripId))) throw notFound("Trip");
  return trip;
}

/** A trip given alongside an order must belong to the company and actually carry that order. */
export async function assertTripCarriesOrder(companyId: number, tripId: number | null | undefined, orderId: number) {
  if (!tripId) return;
  const stop = await prisma.tripStop.findFirst({ where: { tripId, orderId, trip: { companyId } } });
  if (!stop) throw badRequest("That trip does not carry this order");
}

export async function issuerOf(companyId: number) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  return { name: c.name, address: c.address, city: c.city, state: c.state, gstNumber: c.gstNumber, phone: c.phone };
}

export function placeOf(l: { name: string; city?: string | null; state?: string | null }) {
  return [l.name, l.city, l.state].filter(Boolean).join(", ");
}

/** Driver callers only see orders on their own trips. */
export function driverOrderFilter(auth: AuthContext) {
  return auth.role === "DRIVER" ? { tripStops: { some: { trip: { driverId: auth.driverId ?? -1 } } } } : {};
}

export function sendPdf(res: import("express").Response, data: Buffer, fileName: string, inline: boolean) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
}
