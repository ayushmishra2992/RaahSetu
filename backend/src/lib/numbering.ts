/** Human-friendly document numbers, e.g. TRP-20261019-4821. Uniqueness is enforced by DB constraints. */
export function docNumber(prefix: string, date = new Date()): string {
  const d = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${d}-${rand}`;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
