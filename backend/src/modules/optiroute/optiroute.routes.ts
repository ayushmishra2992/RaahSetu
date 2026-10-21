import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { DEFAULT_WEIGHTS } from "../../optimizer/costModel";
import { dispatchRun, getRun, OptimizeRequestSchema, runOptimization } from "./optiroute.service";

const router = Router();

const summarySelect = {
  id: true,
  name: true,
  algorithm: true,
  status: true,
  seed: true,
  objective: true,
  feasible: true,
  totalDistanceKm: true,
  totalCo2Kg: true,
  totalCost: true,
  unservedCount: true,
  runtimeMs: true,
  distanceSource: true,
  dispatchedAt: true,
  createdAt: true,
} as const;

/** Describes the optimization contract so the UI can render forms and explanations. */
router.get("/meta", requirePermission("optimize:read"), (_req, res) => {
  res.json({
    algorithms: [
      { id: "GREEDY_INSERTION", label: "Greedy insertion (baseline)", description: "Deterministic cheapest feasible insertion of each order's pickup+drop pair, highest priority first." },
      { id: "LOCAL_SEARCH", label: "Local search", description: "Baseline followed by best-improvement relocate moves until no move improves the objective." },
      { id: "SIMULATED_ANNEALING", label: "Simulated annealing (metaheuristic)", description: "Seeded remove-and-reinsert annealing from the baseline, then local-search polish. Reproducible for the same seed." },
    ],
    defaultWeights: DEFAULT_WEIGHTS,
    objective: "J = w_time·hours + w_distance·km + w_cost·operating cost + w_emissions·kg CO₂ + w_lateness·late minutes + w_risk·risk + unserved penalty × priority",
    hardConstraints: ["Vehicle capacity at every point of the route", "Pickup before delivery on the same vehicle", "Delivery time windows (unless soft windows are chosen)", "Driver shift limit", "Vehicle/driver eligibility (status, depot, unexpired RC/insurance/PUC/fitness/permit, valid licence)", "Closed roads are not used"],
  });
});

router.get("/runs", requirePermission("optimize:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }), req);
  res.json(await prisma.optimizationRun.findMany({ where: { companyId: auth.companyId }, select: summarySelect, orderBy: { createdAt: "desc" }, take: q.limit }));
});

router.get("/runs/:id", requirePermission("optimize:read"), async (req, res) => {
  const auth = authOf(req);
  res.json(await getRun(auth.companyId, parseId(req.params.id)));
});

router.post("/runs", requirePermission("optimize:run"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(OptimizeRequestSchema, req);
  const run = await runOptimization(auth, body);
  res.status(201).json(run);
});

router.post("/runs/:id/dispatch", requirePermission("trips:write"), async (req, res) => {
  const auth = authOf(req);
  const trips = await dispatchRun(auth, parseId(req.params.id));
  res.status(201).json({ trips });
});

export default router;
