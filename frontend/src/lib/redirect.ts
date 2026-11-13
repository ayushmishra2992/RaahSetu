/**
 * Post-login destination from an untrusted `?next=` value. Only same-origin
 * paths are allowed; anything a browser could resolve to another host
 * ("//host", "/\\host" which browsers normalise to "//host", "https://…",
 * control characters) falls back.
 */
export function safeNext(next: string | null | undefined, origin: string, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.includes("\\") || /[\u0000-\u001f]/.test(next) || next.startsWith("//")) return fallback;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
