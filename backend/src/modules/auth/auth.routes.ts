import bcrypt from "bcryptjs";
import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { conflict, unauthorized } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { permissionsFor } from "../../lib/permissions";
import { parseBody } from "../../lib/validate";
import { AUTH_COOKIE, authenticate, signToken } from "../../middleware/auth";
import { parseSettings } from "../company/settings";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_PER_15_MIN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Please try again later." } },
});

export const zEmail = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
export const zPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

const RegisterCompany = z.object({
  companyName: z.string().trim().min(2).max(120),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 alphanumeric characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  adminName: z.string().trim().min(2).max(120),
  email: zEmail,
  password: zPassword,
});

let dummyHash: string | undefined;

const Login = z.object({ email: zEmail, password: z.string().min(1).max(128) });

function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24,
  });
}

async function profile(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      driver: { select: { id: true, name: true } },
      company: true,
    },
  });
  const { company, ...rest } = user;
  return {
    user: rest,
    company: { ...company, settings: parseSettings(company.settings) },
    permissions: permissionsFor(user.role),
  };
}

router.post("/register-company", authLimiter, async (req, res) => {
  const body = parseBody(RegisterCompany, req);
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw conflict("A user with this email already exists");
  if (body.gstNumber) {
    const gst = await prisma.company.findUnique({ where: { gstNumber: body.gstNumber } });
    if (gst) throw conflict("A company with this GSTIN is already registered");
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name: body.companyName, gstNumber: body.gstNumber ?? null, city: body.city, state: body.state },
    });
    const admin = await tx.user.create({
      data: { email: body.email, name: body.adminName, passwordHash, role: "ADMIN", companyId: company.id },
    });
    await tx.auditEvent.create({
      data: { companyId: company.id, userId: admin.id, action: "company.registered", entityType: "Company", entityId: company.id },
    });
    return admin;
  });
  const token = signToken(user.id);
  setAuthCookie(res, token);
  res.status(201).json({ token, ...(await profile(user.id)) });
});

router.post("/login", authLimiter, async (req, res) => {
  const body = parseBody(Login, req);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  // Compare against a dummy hash when the user is missing to keep timing similar.
  dummyHash ??= await bcrypt.hash("timing-equaliser-not-a-password", 12);
  const hash = user?.passwordHash ?? dummyHash;
  const valid = await bcrypt.compare(body.password, hash);
  if (!user || !valid) throw unauthorized("Invalid email or password");
  if (!user.isActive) throw unauthorized("This account has been deactivated");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = signToken(user.id);
  setAuthCookie(res, token);
  res.json({ token, ...(await profile(user.id)) });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", authenticate, async (req, res) => {
  res.json(await profile(authOf(req).userId));
});

const ChangePassword = z.object({ currentPassword: z.string().min(1), newPassword: zPassword });

router.post("/change-password", authenticate, async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(ChangePassword, req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw unauthorized("Current password is incorrect");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } });
  await audit(auth, "user.password_changed", "User", user.id);
  res.json({ ok: true });
});

export default router;
