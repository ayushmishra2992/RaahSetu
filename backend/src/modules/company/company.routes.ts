import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { authOf } from "../../lib/http";
import { badRequest } from "../../lib/errors";
import { parseBody, zOptionalText } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { applySettingsPatch, parseSettings } from "./settings";

const router = Router();

router.get("/", async (req, res) => {
  const auth = authOf(req);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: auth.companyId } });
  res.json({ ...company, settings: parseSettings(company.settings) });
});

const UpdateCompany = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  gstNumber: zOptionalText,
  address: zOptionalText,
  city: zOptionalText,
  state: zOptionalText,
  phone: zOptionalText,
  /**
   * A PARTIAL settings object: only the keys sent are changed (deep merge), so
   * saving one section never resets another (e.g. compliance policy). The merged
   * result is validated as a whole.
   */
  settings: z.record(z.string(), z.unknown()).optional(),
});

router.patch("/", requirePermission("company:manage"), async (req, res) => {
  const auth = authOf(req);
  const { settings: patch, ...profile } = parseBody(UpdateCompany, req);
  const company = await prisma.$transaction(async (tx) => {
    // Lock the row so two concurrent saves cannot each merge into the same old settings.
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${auth.companyId} FOR UPDATE`;
    let settings: unknown;
    if (patch) {
      const current = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { settings: true } });
      const merged = applySettingsPatch(current.settings, patch);
      if (!merged.success) throw badRequest("Validation failed", merged.error.issues.map((i) => ({ path: ["settings", ...i.path].join("."), message: i.message })));
      settings = merged.data;
    }
    return tx.company.update({
      where: { id: auth.companyId },
      data: { ...profile, gstNumber: profile.gstNumber?.toUpperCase() ?? profile.gstNumber, ...(settings !== undefined ? { settings: settings as never } : {}) },
    });
  });
  await audit(auth, "company.updated", "Company", company.id, { fields: Object.keys(profile), settingsKeys: patch ? Object.keys(patch) : [] });
  res.json({ ...company, settings: parseSettings(company.settings) });
});

export default router;
