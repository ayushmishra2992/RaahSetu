import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import type { UserRole } from "../generated/prisma/enums";
import { forbidden, unauthorized } from "../lib/errors";
import { can, type Permission } from "../lib/permissions";

export const AUTH_COOKIE = "rs_token";

export interface AuthContext {
  userId: number;
  companyId: number;
  role: UserRole;
  email: string;
  driverId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

interface TokenPayload {
  sub: string;
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const cookie = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
  return cookie ?? null;
}

/**
 * Verifies the JWT and loads the user fresh from the database so that
 * deactivated users and role changes take effect immediately. The company
 * scope always comes from the database record, never from the client.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) throw unauthorized();
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as TokenPayload;
  } catch {
    throw unauthorized("Session expired or invalid. Please log in again.");
  }
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId)) throw unauthorized();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true, role: true, email: true, isActive: true, driver: { select: { id: true } } },
  });
  if (!user || !user.isActive) throw unauthorized("Account is inactive or no longer exists");
  req.auth = {
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
    driverId: user.driver?.id ?? null,
  };
  next();
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    const role = req.auth.role;
    if (!permissions.some((p) => can(role, p))) throw forbidden();
    next();
  };
}
