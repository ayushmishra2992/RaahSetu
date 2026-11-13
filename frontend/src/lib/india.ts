/**
 * Indian states / union territories and PIN codes for the location form.
 * Mirrors backend/src/modules/places/india.ts (the API also stores states
 * under these canonical names).
 */

const REGIONS: Array<[canonical: string, aliases: string[]]> = [
  ["Andhra Pradesh", []],
  ["Arunachal Pradesh", []],
  ["Assam", []],
  ["Bihar", []],
  ["Chhattisgarh", ["Chattisgarh"]],
  ["Goa", []],
  ["Gujarat", []],
  ["Haryana", []],
  ["Himachal Pradesh", []],
  ["Jharkhand", []],
  ["Karnataka", []],
  ["Kerala", []],
  ["Madhya Pradesh", []],
  ["Maharashtra", []],
  ["Manipur", []],
  ["Meghalaya", []],
  ["Mizoram", []],
  ["Nagaland", []],
  ["Odisha", ["Orissa"]],
  ["Punjab", []],
  ["Rajasthan", []],
  ["Sikkim", []],
  ["Tamil Nadu", []],
  ["Telangana", []],
  ["Tripura", []],
  ["Uttar Pradesh", []],
  ["Uttarakhand", ["Uttaranchal"]],
  ["West Bengal", []],
  ["Andaman and Nicobar Islands", ["Andaman & Nicobar Islands", "Andaman and Nicobar"]],
  ["Chandigarh", []],
  ["Dadra and Nagar Haveli and Daman and Diu", ["Dadra and Nagar Haveli", "Daman and Diu", "Dadra & Nagar Haveli and Daman & Diu"]],
  ["Delhi", ["NCT of Delhi", "National Capital Territory of Delhi", "Delhi NCT", "New Delhi"]],
  ["Jammu and Kashmir", ["Jammu & Kashmir"]],
  ["Ladakh", []],
  ["Lakshadweep", []],
  ["Puducherry", ["Pondicherry"]],
];

/** 28 states then 8 union territories, for the state picker. */
export const INDIAN_STATES_AND_UTS: readonly string[] = REGIONS.map(([c]) => c);

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const BY_KEY = new Map<string, string>();
for (const [canonical, aliases] of REGIONS) for (const n of [canonical, ...aliases]) BY_KEY.set(key(n), canonical);

/** Canonical state/UT name for a spelling ("orissa" → "Odisha"), or null. */
export function canonicalRegion(value: string | null | undefined): string | null {
  return value ? (BY_KEY.get(key(value)) ?? null) : null;
}

/** Valid Indian PIN code (6 digits, first not 0) with spaces removed, else null. */
export function indianPin(value: string | null | undefined): string | null {
  const v = value?.replace(/\s+/g, "");
  return v && /^[1-9]\d{5}$/.test(v) ? v : null;
}

/** Form message for a PIN field (empty is allowed). */
export function pinProblem(value: string): string | null {
  return value.trim() && !indianPin(value) ? "Enter a 6-digit PIN code, e.g. 400059." : null;
}
