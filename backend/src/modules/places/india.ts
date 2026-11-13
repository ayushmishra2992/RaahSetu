/**
 * Indian address rules for location search results.
 *
 * Based on raw LocationIQ responses (2026-11-13):
 * - Delhi results carry no `state` at all ("Connaught Place, …, Delhi, 110001, India").
 * - Ward / zone / taluka / tehsil names appear in `suburb`, `town`, `county` or
 *   `city_district` ("K/E Ward", "S Ward", "Mumbai Zone 3", "Khed").
 * - `city` is sometimes a state name ("West Bengal" for Haringhata).
 * - PIN-code results may have no city, only "… Suburban District".
 */

/** The 28 states and 8 union territories, with common alternative spellings. */
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

export const INDIAN_STATES_AND_UTS: readonly string[] = REGIONS.map(([c]) => c);

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const REGION_BY_KEY = new Map<string, string>();
for (const [canonical, aliases] of REGIONS) for (const name of [canonical, ...aliases]) REGION_BY_KEY.set(key(name), canonical);

/** Canonical state/UT name for a spelling, or null if it isn't one. */
export function canonicalRegion(value: string | null | undefined): string | null {
  if (!value) return null;
  return REGION_BY_KEY.get(key(value)) ?? null;
}

/** Cities that are also (the capital of) a union territory: valid as a city name. */
const CITY_REGIONS = new Map<string, string>([
  ["delhi", "Delhi"],
  ["new delhi", "Delhi"],
  ["chandigarh", "Chandigarh"],
  ["puducherry", "Puducherry"],
  ["pondicherry", "Puducherry"],
]);

const ADMIN_UNIT = [
  /\bward\b/i, // "K/E Ward", "S Ward", "Ward 104 Kondapur"
  /\bzone\b/i, // "Mumbai Zone 3"
  /\b(sub[- ]?district|subdivision|sub[- ]?division)\b/i,
  /\b(tehsil|tahsil|taluka|taluk|mandal|block)\b/i,
  /\bdistrict\b/i,
  /\bcorporation\b/i, // "Bengaluru South City Corporation"
];

/** True for administrative units that must not be used as a city name. */
export function isAdministrativeUnit(value: string | null | undefined): boolean {
  if (!value) return false;
  return ADMIN_UNIT.some((re) => re.test(value));
}

/** "Mumbai Suburban District" → "Mumbai", "Pune District" → "Pune"; null if not a district name. */
export function cityFromDistrict(value: string | null | undefined): string | null {
  const m = value?.trim().match(/^(.+?)\s+(?:(?:suburban|city|urban|rural)\s+)?district$/i);
  if (!m) return null;
  const city = m[1].trim();
  return city && !isAdministrativeUnit(city) && !canonicalRegion(city) ? city : null;
}

/** Valid Indian PIN code (6 digits, first not 0), with spaces removed; otherwise null. */
export function indianPin(value: string | null | undefined): string | null {
  const v = value?.replace(/\s+/g, "");
  return v && /^[1-9]\d{5}$/.test(v) ? v : null;
}

function usableCity(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || /^\d+$/.test(v) || isAdministrativeUnit(v)) return null;
  if (canonicalRegion(v) && !CITY_REGIONS.has(key(v))) return null; // a state name, e.g. "West Bengal"
  return v;
}

const SETTLEMENT_TYPES = new Set(["city", "town", "village", "hamlet", "suburb", "locality", "neighbourhood", "quarter"]);

export interface RawAddressInput {
  /** Provider's full single-line address (kept unchanged elsewhere). */
  displayName: string;
  /** Result name ("Haringhata", "Andheri East"). */
  name?: string | null;
  /** Result class/type, e.g. place/town, boundary/administrative. */
  category?: string | null;
  type?: string | null;
  address: Record<string, string | undefined>;
}

export interface IndianAddressParts {
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

/** City, state and PIN from a provider address, using the rules above. */
export function extractIndianAddress(input: RawAddressInput): IndianAddressParts {
  const a = input.address;
  const parts = input.displayName
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  // State: the provider's field if it is a real state/UT, else scan the full address from the right.
  let state = canonicalRegion(a.state);
  if (!state) {
    for (let i = parts.length - 1; i >= 0 && !state; i -= 1) {
      const p = parts[i];
      if (/^india$/i.test(p) || /^\d+$/.test(p.replace(/\s+/g, ""))) continue;
      state = canonicalRegion(p);
    }
  }

  // City: real settlements first; the result's own name for settlement/boundary results; then a district name.
  const isPlace = (input.category === "place" && SETTLEMENT_TYPES.has(input.type ?? "")) || (input.category === "boundary" && input.type === "administrative");
  const candidates = [a.city, a.town, a.village, a.hamlet, isPlace ? input.name : null];
  let city: string | null = null;
  for (const c of candidates) {
    city = usableCity(c);
    if (city) break;
  }
  city ??= cityFromDistrict(a.state_district) ?? cityFromDistrict(a.county);

  if (!state && city) state = CITY_REGIONS.get(key(city)) ?? null;

  return { city, state, postalCode: indianPin(a.postcode) };
}
