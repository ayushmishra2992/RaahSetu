import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { authOf } from "../../lib/http";
import { parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";

const router = Router();

router.get("/", requirePermission("audit:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(
    z.object({ entityType: z.string().max(40).optional(), entityId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }),
    req,
  );
  const events = await prisma.auditEvent.findMany({
    where: { companyId: auth.companyId, entityType: q.entityType, entityId: q.entityId },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  const userIds = [...new Set(events.map((e) => e.userId).filter((x): x is number => x != null))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, companyId: auth.companyId }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json(events.map((e) => ({ ...e, userName: e.userId ? (names.get(e.userId) ?? null) : null })));
});

export default router;
