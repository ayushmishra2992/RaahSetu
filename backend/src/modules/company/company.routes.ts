import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { authOf } from "../../lib/http";
import { parseBody, zOptionalText } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { CompanySettingsSchema, parseSettings } from "./settings";

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
  settings: CompanySettingsSchema.optional(),
});

router.patch("/", requirePermission("company:manage"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(UpdateCompany, req);
  const company = await prisma.company.update({
    where: { id: auth.companyId },
    data: { ...body, gstNumber: body.gstNumber?.toUpperCase() ?? body.gstNumber, settings: body.settings as never },
  });
  await audit(auth, "company.updated", "Company", company.id, { fields: Object.keys(body) });
  res.json({ ...company, settings: parseSettings(company.settings) });
});

export default router;
