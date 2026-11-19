import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { complianceOverview, dispatchCheck, redactDispatchCheck, visibilityFor } from "./compliance.service";

const router = Router();

/** Company-wide compliance status (dashboard and compliance page). */
router.get("/overview", requirePermission("documents:read"), async (req, res) => {
  const auth = authOf(req);
  res.json(await complianceOverview(auth.companyId, visibilityFor(auth.role)));
});

/**
 * Pre-dispatch check without dispatching: is this vehicle + driver (+ orders)
 * allowed, and what must be fixed first? A planning tool for dispatch staff only
 * (trips:write): drivers must not inspect arbitrary vehicles or other drivers.
 */
router.get("/check", requirePermission("trips:write"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(
    z.object({
      vehicleId: z.coerce.number().int().positive(),
      driverId: z.coerce.number().int().positive(),
      orderIds: z
        .string()
        .optional()
        .transform((s) => (s ? s.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0) : [])),
      at: z.coerce.date().optional(),
    }),
    req,
  );
  const [v, d] = await Promise.all([
    prisma.vehicle.count({ where: { id: q.vehicleId, companyId: auth.companyId } }),
    prisma.driver.count({ where: { id: q.driverId, companyId: auth.companyId } }),
  ]);
  if (!v) throw notFound("Vehicle");
  if (!d) throw notFound("Driver");
  const check = await dispatchCheck(prisma, auth.companyId, { vehicleId: q.vehicleId, driverId: q.driverId, orderIds: q.orderIds }, q.at ?? new Date());
  res.json(redactDispatchCheck(check, visibilityFor(auth.role)));
});

export default router;
