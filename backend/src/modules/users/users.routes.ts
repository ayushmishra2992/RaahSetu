import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { zEmail, zPassword } from "../auth/auth.routes";

const router = Router();
router.use(requirePermission("users:manage"));

const Role = z.enum(["ADMIN", "MANAGER", "DISPATCHER", "EMPLOYEE", "DRIVER"]);
const userSelect = { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, driver: { select: { id: true, name: true } } } as const;

router.get("/", async (req, res) => {
  const auth = authOf(req);
  res.json(await prisma.user.findMany({ where: { companyId: auth.companyId }, select: userSelect, orderBy: { createdAt: "asc" } }));
});

const CreateUser = z.object({ name: z.string().trim().min(2).max(120), email: zEmail, password: zPassword, role: Role });

router.post("/", async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(CreateUser, req);
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict("A user with this email already exists");
  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, role: body.role, companyId: auth.companyId, passwordHash: await bcrypt.hash(body.password, 12) },
    select: userSelect,
  });
  await audit(auth, "user.created", "User", user.id, { role: user.role });
  res.status(201).json(user);
});

const UpdateUser = z.object({ name: z.string().trim().min(2).max(120).optional(), role: Role.optional(), isActive: z.boolean().optional() });

router.patch("/:id", async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const body = parseBody(UpdateUser, req);
  const target = await prisma.user.findFirst({ where: { id, companyId: auth.companyId } });
  if (!target) throw notFound("User");
  if (id === auth.userId && (body.isActive === false || (body.role && body.role !== "ADMIN"))) {
    throw badRequest("You cannot deactivate or demote your own account");
  }
  if (target.role === "ADMIN" && (body.isActive === false || (body.role && body.role !== "ADMIN"))) {
    const admins = await prisma.user.count({ where: { companyId: auth.companyId, role: "ADMIN", isActive: true } });
    if (admins <= 1) throw badRequest("The company must keep at least one active admin");
  }
  const user = await prisma.user.update({ where: { id }, data: body, select: userSelect });
  await audit(auth, "user.updated", "User", id, body);
  res.json(user);
});

export default router;
