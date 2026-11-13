import type { Location } from "./types";

/**
 * Location search (provider-independent). The browser only calls RaahSetu's
 * own /api/places/* endpoints; the backend holds the provider key and maps
 * the provider's response to PlaceSuggestion. See backend/src/modules/places.
 */

export interface AttributionLink {
  text: string;
  url: string;
}

export interface PlacesStatus {
  enabled: boolean;
  provider: string | null;
  attribution: AttributionLink[];
  reason?: "not_configured" | "missing_key" | null;
  minQueryLength: number;
  /** The provider can look up the address at a pin ("Use pin's address"). */
  reverse?: boolean;
}

/** GET /api/places/reverse: nearest address to the pin. The pin itself is never moved. */
export interface ReverseResponse {
  provider: string;
  attribution: AttributionLink[];
  place: PlaceSuggestion | null;
  /** Metres from the pin to the matched address point. */
  distanceM: number | null;
}

export interface PlaceSuggestion {
  providerPlaceId: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  lat: number;
  lng: number;
}

export interface PlaceSearchResponse {
  provider: string;
  attribution: AttributionLink[];
  results: PlaceSuggestion[];
}

/** How the coordinates were obtained (kept for a future `Location.coordsSource`). */
export type CoordSource = "SEARCH" | "PIN_ADJUSTED" | "MANUAL" | "EXISTING";

/** What the picker hands back to its form. */
export interface PlaceValue {
  lat: number | null;
  lng: number | null;
  source: CoordSource;
  /** Present when a search result was chosen (and kept after a pin adjustment). */
  place?: (PlaceSuggestion & { provider: string }) | null;
}

export const EMPTY_PLACE: PlaceValue = { lat: null, lng: null, source: "MANUAL", place: null };

/** Default map view before anything is chosen (centre of India). */
export const INDIA_CENTER = { lat: 22.5, lng: 79, zoom: 4 };

/** Round to 6 decimals (~0.1 m), the precision we keep for pins. */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function coordProblem(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return "Choose a place, drop a pin on the map, or enter coordinates.";
  if (lat < -90 || lat > 90) return "Latitude must be between −90 and 90.";
  if (lng < -180 || lng > 180) return "Longitude must be between −180 and 180.";
  return null;
}

/** "Mumbai, Maharashtra 400059" — the locality line shown under a chosen place. */
export function localityLine(p: Pick<PlaceSuggestion, "city" | "state" | "postalCode">): string {
  const cityState = [p.city, p.state].filter(Boolean).join(", ");
  return [cityState, p.postalCode].filter(Boolean).join(" ");
}

/** Distance in metres between two coordinates (haversine), for "pin moved by…" notes. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fmtDistanceM(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export interface LocationPlaceFields {
  lat: number;
  lng: number;
  coordsSource?: "MANUAL" | "SEARCH" | "PIN_ADJUSTED";
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  placeProvider?: string | null;
  providerPlaceId?: string | null;
}

/** Providers the API accepts as `placeProvider`. */
export const KNOWN_PROVIDERS = ["locationiq", "geoapify"] as const;

/**
 * Location API fields for a picker value.
 * - Unchanged saved pin (EXISTING): coordinates only, provenance untouched.
 * - Search result, optionally with the pin moved: address parts + provider ids.
 * - Saved location with search details, pin dragged/clicked: PIN_ADJUSTED.
 * - Pin placed or typed without search: MANUAL. On a new location the search
 *   details are cleared; on an edit they're kept.
 */
export function locationFieldsFromPlace(v: PlaceValue, opts: { isNew: boolean } = { isNew: true }): LocationPlaceFields | null {
  if (coordProblem(v.lat, v.lng)) return null;
  const coords = { lat: round6(v.lat as number), lng: round6(v.lng as number) };
  if (v.source === "EXISTING") return coords;
  if ((v.source === "SEARCH" || v.source === "PIN_ADJUSTED") && v.place && v.place.provider !== "saved") {
    const p = v.place;
    return {
      ...coords,
      coordsSource: v.source,
      city: p.city,
      state: p.state,
      postalCode: p.postalCode,
      country: p.country,
      placeProvider: (KNOWN_PROVIDERS as readonly string[]).includes(p.provider) ? p.provider : null,
      providerPlaceId: p.providerPlaceId || null,
    };
  }
  if (v.source === "PIN_ADJUSTED") return { ...coords, coordsSource: "PIN_ADJUSTED" }; // saved search location, pin moved
  if (opts.isNew) return { ...coords, coordsSource: "MANUAL", city: null, state: null, postalCode: null, country: null, placeProvider: null, providerPlaceId: null };
  return { ...coords, coordsSource: "MANUAL" }; // typed coordinates on an edit; saved address details are kept
}

/* ─── Search efficiency ─────────────────────────────────────────────────── */

const EDGE_PUNCTUATION = /^[\s,.;:!?\-–—/\\|]+|[\s,.;:!?\-–—/\\|]+$/g;

/** Collapse runs of spaces and strip leading/trailing punctuation: "  Bhiwandi ,. " → "Bhiwandi". */
export function normaliseQuery(q: string): string {
  return q.replace(/\s+/g, " ").replace(EDGE_PUNCTUATION, "").trim();
}

const cacheKey = (q: string) => normaliseQuery(q).toLowerCase();

/**
 * Per-dialog memory of search results (never persisted).
 * - Repeating a query (after backspacing, retyping, changing case) is free.
 * - A query that only adds letters to an earlier query with no results cannot
 *   match anything new (suggestions match word prefixes), so it isn't sent.
 *   Queries with digits are excluded: a partial PIN ("40005") finds nothing
 *   although the full PIN does. Short dead ends (< 4 characters, or a last
 *   word under 3) are also not used, to stay on the safe side.
 */
export class SearchCache {
  private readonly results = new Map<string, PlaceSearchResponse>();
  private readonly deadEnds = new Set<string>();

  constructor(private readonly max = 60) {}

  get(q: string): PlaceSearchResponse | undefined {
    return this.results.get(cacheKey(q));
  }

  set(q: string, r: PlaceSearchResponse): void {
    const k = cacheKey(q);
    if (this.results.size >= this.max && !this.results.has(k)) this.results.delete(this.results.keys().next().value as string);
    this.results.set(k, r);
    const last = k.split(" ").pop() ?? "";
    if (r.results.length === 0 && !/\d/.test(k) && k.length >= 4 && last.length >= 3) this.deadEnds.add(k);
  }

  /** True when `q` only extends an earlier query that returned nothing. */
  extendsDeadEnd(q: string): boolean {
    const k = cacheKey(q);
    if (/\d/.test(k)) return false;
    for (const d of this.deadEnds) if (k !== d && k.startsWith(d)) return true;
    return false;
  }

  get size(): number {
    return this.results.size;
  }
}

const GENERIC_WORDS = new Set(
  "warehouse warehouses godown godowns fulfillment fulfilment fc center centre hub dc store stores shop facility unit plant office branch pvt private ltd limited llp inc co company corp the near opp opposite behind beside and &".split(" "),
);

/**
 * Broader queries to offer after zero results (the user chooses; nothing is sent automatically).
 * Drops generic business words first ("Amazon fulfillment center Bhiwandi" → "Amazon Bhiwandi");
 * otherwise offers the query without its last word and the last word on its own.
 */
export function broadenOptions(q: string): string[] {
  const words = normaliseQuery(q).split(" ").filter(Boolean);
  if (words.length < 2) return [];
  const core = words.filter((w) => !GENERIC_WORDS.has(w.toLowerCase().replace(/[.,]/g, "")));
  const options = core.length > 0 && core.length < words.length ? [core.join(" ")] : [words.slice(0, -1).join(" "), words[words.length - 1]];
  const current = cacheKey(q);
  return [...new Set(options.map(normaliseQuery))].filter((o) => o.length >= 3 && o.toLowerCase() !== current).slice(0, 2);
}

/* ─── Saved locations and duplicates ────────────────────────────────────── */

const fold = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim();

/** The company's own locations matching every word of the query (name, address, city or PIN). */
export function savedMatches(query: string, locations: Location[], max = 5): Location[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length || fold(query).length < 2) return [];
  return locations
    .filter((l) => {
      const hay = fold(`${l.name} ${l.address ?? ""} ${l.city ?? ""} ${l.postalCode ?? ""}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, max);
}

export type DuplicateReason = "very close" | "same name nearby" | "same place";

export interface DuplicateMatch {
  location: Location;
  distanceM: number;
  reasons: DuplicateReason[];
}

/** Within this distance two pins are treated as the same spot. */
export const SAME_SPOT_M = 60;
/** The same name counts as a duplicate only this close; farther away it is a different site. */
export const SAME_NAME_M = 1_000;

/**
 * Existing locations a new/edited one probably duplicates. Never blocks on its
 * own: the form asks the user to use the existing one or save anyway.
 * The same name far away (another city's "Customer warehouse") is not a duplicate.
 */
export function findDuplicates(
  candidate: { name: string; lat: number; lng: number; placeProvider?: string | null; providerPlaceId?: string | null },
  existing: Location[],
  excludeId?: number,
): DuplicateMatch[] {
  const name = fold(candidate.name);
  const out: DuplicateMatch[] = [];
  for (const l of existing) {
    if (l.id === excludeId) continue;
    const distanceM = Math.round(metresBetween(candidate, l));
    const reasons: DuplicateReason[] = [];
    if (distanceM <= SAME_SPOT_M) reasons.push("very close");
    if (name && fold(l.name) === name && distanceM <= SAME_NAME_M) reasons.push("same name nearby");
    if (candidate.providerPlaceId && l.providerPlaceId === candidate.providerPlaceId && (!candidate.placeProvider || l.placeProvider === candidate.placeProvider)) reasons.push("same place");
    if (reasons.length) out.push({ location: l, distanceM, reasons });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/** Key for caching reverse lookups of the same pin (≈1 m). */
export const pinKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
