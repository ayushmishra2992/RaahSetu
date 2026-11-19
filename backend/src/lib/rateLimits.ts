import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { AppError } from "./errors";

/**
 * Per-user limits for the memory-heavy document endpoints. Uploads are buffered
 * in memory (up to 8 × MAX_UPLOAD_MB per request) and trip packs are built in
 * memory, so a burst of requests could exhaust a small instance. These routes are
 * authenticated, so the key is the user, not the IP (shared office NAT is fine).
 */
function perUser(name: string, perMinute: number, message: string) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `${name}:user:${req.auth?.userId ?? "anon"}`,
    handler: (_req, _res, next) => next(new AppError(429, message, "RATE_LIMITED")),
  });
}

export const uploadLimiter = perUser("upload", env.UPLOAD_RATE_LIMIT_PER_MIN, "Too many uploads in the last minute. Wait a moment and try again.");
export const packLimiter = perUser("pack", env.PACK_RATE_LIMIT_PER_MIN, "Too many document-pack downloads in the last minute. Wait a moment and try again.");
