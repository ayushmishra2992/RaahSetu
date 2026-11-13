/**
 * /api/places — server-side proxy for location search.
 *
 * - The provider API key stays on the server; the browser only talks to us.
 * - Signed-in users only; searching needs locations:write (the only reason to
 *   search is to create or edit a location).
 * - Rate-limited per company so one tenant cannot exhaust the shared quota.
 * - No response caching: results are stored only when a user saves a Location.
 * - When no provider is configured, /status says so and /autocomplete returns
 *   503 PLACES_DISABLED; the UI falls back to the map pin / manual coordinates.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { PlacesProviderError } from "./places.types";
import { providerFromSettings, type ProviderConfig } from "./providers";

const fromEnv = () => providerFromSettings(env.PLACES_PROVIDER, env.PLACES_API_KEY, undefined, env.PLACES_FALLBACK_PROVIDER, env.PLACES_FALLBACK_API_KEY);

const MAX_RESULTS = 6;

const AutocompleteQuery = z.object({
  q: z.string().trim().min(3, "Type at least 3 characters").max(120),
});

const ReverseQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

function providerFailure(err: PlacesProviderError): AppError {
  switch (err.reason) {
    case "rate_limited":
      return new AppError(503, "Location search is busy right now. Try again in a minute, or place the pin on the map.", "PLACES_RATE_LIMITED");
    case "auth":
      return new AppError(503, "Location search is not available (provider credentials were rejected). Place the pin on the map instead.", "PLACES_UNAVAILABLE");
    case "timeout":
      return new AppError(504, "Location search took too long. Try again, or place the pin on the map.", "PLACES_TIMEOUT");
    default:
      return new AppError(502, "Location search is temporarily unavailable. Try again, or place the pin on the map.", "PLACES_UNAVAILABLE");
  }
}

export function createPlacesRouter(config: ProviderConfig = fromEnv(), perCompanyPerMinute = env.PLACES_RATE_LIMIT_PER_MIN) {
  const router = Router();
  const { provider, disabledReason } = config;

  router.get("/status", requirePermission("locations:read"), (_req, res) => {
    res.json(
      provider
        ? { enabled: true, provider: provider.id, fallback: provider.fallbackId ?? null, reverse: typeof provider.reverse === "function", attribution: provider.attribution, minQueryLength: 3 }
        : { enabled: false, provider: null, reverse: false, attribution: [], reason: disabledReason, minQueryLength: 3 },
    );
  });

  // One per-company budget shared by searches and reverse lookups.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: perCompanyPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `company:${req.auth?.companyId ?? "anon"}`,
    handler: (_req, _res, next) => next(new AppError(429, "Too many location searches from your company in the last minute. Wait a moment and try again.", "PLACES_RATE_LIMITED")),
  });

  router.get("/autocomplete", requirePermission("locations:write"), limiter, async (req, res) => {
    authOf(req);
    if (!provider) throw new AppError(503, "Location search is not set up for this workspace. Place the pin on the map or enter coordinates.", "PLACES_DISABLED");
    const { q } = parseQuery(AutocompleteQuery, req);
    const controller = new AbortController();
    // Stop the upstream call if the browser goes away (e.g. the user kept typing).
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const found = await provider.autocomplete(q, { country: env.PLACES_COUNTRY, limit: MAX_RESULTS, signal: controller.signal });
      // provider/attribution name whoever answered (the fallback, if the primary failed).
      res.set("Cache-Control", "no-store").json({ provider: found.provider, attribution: found.attribution, results: found.results.slice(0, MAX_RESULTS) });
    } catch (err) {
      if (err instanceof PlacesProviderError) {
        // Log the reason and status only; upstream URLs contain the API key.
        console.warn(`[places] ${provider.id} ${err.reason}${err.upstreamStatus ? ` HTTP ${err.upstreamStatus}` : ""}`);
        throw providerFailure(err);
      }
      throw err;
    }
  });

  // "Use pin's address": nearest address to a point. Only called when the user asks for it.
  router.get("/reverse", requirePermission("locations:write"), limiter, async (req, res) => {
    authOf(req);
    if (!provider) throw new AppError(503, "Location search is not set up for this workspace. Enter the address by hand.", "PLACES_DISABLED");
    if (!provider.reverse) throw new AppError(501, "This location provider cannot look up an address from a pin.", "PLACES_REVERSE_UNSUPPORTED");
    const { lat, lng } = parseQuery(ReverseQuery, req);
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const found = await provider.reverse(lat, lng, { signal: controller.signal });
      res.set("Cache-Control", "no-store").json(found);
    } catch (err) {
      if (err instanceof PlacesProviderError) {
        console.warn(`[places] ${provider.id} reverse ${err.reason}${err.upstreamStatus ? ` HTTP ${err.upstreamStatus}` : ""}`);
        throw providerFailure(err);
      }
      throw err;
    }
  });

  return router;
}
