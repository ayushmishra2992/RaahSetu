/**
 * Browser API client. Requests go to same-origin `/api/*`, which Next.js
 * rewrites to the Express backend (see next.config.ts), so the httpOnly
 * session cookie works without CORS.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T = unknown>(path: string, options: { method?: string; body?: Body } = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      credentials: "same-origin",
      headers: isForm || !options.body ? undefined : { "Content-Type": "application/json" },
      body: isForm ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the RaahSetu API. Is the backend running on port 5000?");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; details?: unknown } } | undefined)?.error;
    const fallback = res.status >= 500 ? "Server error — check the backend terminal" : `Request failed (${res.status})`;
    throw new ApiError(res.status, err?.message ?? fallback, err?.details);
  }
  return data as T;
}

type Detail = string | { path?: string; message?: string; reason?: string; label?: string };

function flattenDetails(details: unknown): Detail[] {
  if (Array.isArray(details)) return details as Detail[];
  if (details && typeof details === "object") {
    return Object.values(details as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? (v as Detail[]) : []));
  }
  return [];
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const details = flattenDetails(e.details)
      .slice(0, 5)
      .map((d) =>
        typeof d === "string"
          ? d
          : d.path
            ? `${d.path}: ${d.message}`
            : d.label
              ? `${d.label}: ${d.reason ?? d.message}`
              : (d.message ?? d.reason ?? JSON.stringify(d)),
      )
      .join("; ");
    return details ? `${e.message} — ${details}` : e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
