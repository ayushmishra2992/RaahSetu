import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { Prisma } from "../generated/prisma/client";
import { AppError } from "../lib/errors";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` } });
}

// Express recognises error handlers by their 4-argument signature.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: { code: "UPLOAD_ERROR", message: err.message } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "CONFLICT", message: "A record with these unique values already exists" } });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found" } });
      return;
    }
    // Transaction aborted by a write conflict/deadlock (P2034), or a raw query
    // failing with PostgreSQL's serialization (40001) / deadlock (40P01) codes.
    if (err.code === "P2034" || (err.code === "P2010" && /40001|40P01|deadlock/i.test(err.message))) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Another request changed the same records at the same time. Please retry." } });
      return;
    }
    if (err.code === "P2003") {
      res.status(409).json({
        error: { code: "CONFLICT", message: "This record is referenced by other records and cannot be changed" },
      });
      return;
    }
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed JSON body" } });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
}
