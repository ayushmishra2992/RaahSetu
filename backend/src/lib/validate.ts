import type { Request } from "express";
import { z } from "zod";
import { badRequest } from "./errors";

function format(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) throw badRequest("Validation failed", format(r.error));
  return r.data;
}

export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const r = schema.safeParse(req.query ?? {});
  if (!r.success) throw badRequest("Invalid query parameters", format(r.error));
  return r.data;
}

export function parseId(value: unknown, name = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}

/** Common pieces reused by module schemas. */
export const zId = z.coerce.number().int().positive();
export const zOptionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v === "" ? null : v));
export const zDate = z.coerce.date();
export const zOptionalDate = z.preprocess(
  (v) => (v === "" ? null : v),
  z.coerce.date().nullable().optional(),
);

/**
 * Parse a PATCH body: every field optional, and only keys the client actually
 * sent are returned (so schema defaults never overwrite stored values).
 */
export function parsePatch<T extends z.ZodObject>(schema: T, req: Request): Partial<z.infer<T>> {
  const parsed = parseBody(schema.partial(), req) as Record<string, unknown>;
  const sent = new Set(Object.keys((req.body as Record<string, unknown>) ?? {}));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) if (sent.has(k)) out[k] = v;
  return out as Partial<z.infer<T>>;
}
