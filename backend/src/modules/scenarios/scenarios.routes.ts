import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { decideScenario, evaluateScenario, ScenarioInput } from "./scenarios.service";

const router = Router();

router.get("/", requirePermission("optimize:read"), async (req, res) => {
  const auth = authOf(req);
  res.json(await prisma.scenario.findMany({ where: { companyId: auth.companyId }, orderBy: { createdAt: "desc" }, take: 100 }));
});

router.get("/:id", requirePermission("optimize:read"), async (req, res) => {
  const auth = authOf(req);
  const s = await prisma.scenario.findFirst({ where: { id: parseId(req.params.id), companyId: auth.companyId }, include: { baseRun: true, resultRun: true } });
  if (!s) throw notFound("Scenario");
  res.json(s);
});

router.post("/", requirePermission("optimize:run"), async (req, res) => {
  const auth = authOf(req);
  res.status(201).json(await evaluateScenario(auth, parseBody(ScenarioInput, req)));
});

const Decision = z.object({ note: z.string().trim().max(500).optional().nullable() });

router.post("/:id/approve", requirePermission("scenarios:approve"), async (req, res) => {
  const auth = authOf(req);
  res.json(await decideScenario(auth, parseId(req.params.id), true, parseBody(Decision, req).note));
});

router.post("/:id/reject", requirePermission("scenarios:approve"), async (req, res) => {
  const auth = authOf(req);
  res.json(await decideScenario(auth, parseId(req.params.id), false, parseBody(Decision, req).note));
});

export default router;
