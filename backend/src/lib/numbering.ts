import { randomInt } from "node:crypto";

/** Crockford base32: no I, L, O or U, so numbers are easy to read out over the phone. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const DOC_SUFFIX_LENGTH = 6;

/**
 * Human-friendly document numbers, e.g. TRP-20261019-K7M2QX.
 *
 * The 6-character suffix gives 32^6 ≈ 1.07 billion values per prefix per day,
 * so collisions are negligible (≈4·10⁻⁷ per day at 30 trips/day, versus ≈5%
 * with the previous 4-digit suffix). A collision matters because trips are
 * created inside one transaction: a duplicate number aborts the whole dispatch.
 * Uniqueness is still enforced by DB constraints.
 */
export function docNumber(prefix: string, date = new Date()): string {
  const d = date.toISOString().slice(0, 10).replace(/-/g, "");
  let suffix = "";
  for (let i = 0; i < DOC_SUFFIX_LENGTH; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${d}-${suffix}`;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
