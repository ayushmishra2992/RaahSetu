import type { Request } from "express";
import type { AuthContext } from "../middleware/auth";
import { unauthorized } from "./errors";

export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
