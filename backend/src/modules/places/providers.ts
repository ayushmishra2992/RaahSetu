/**
 * Location search provider adapters. Each adapter calls its provider's
 * autocomplete endpoint from the server (the API key never reaches the
 * browser) and normalises the response to PlaceSuggestion.
 *
 * Nothing here runs unless PLACES_PROVIDER and PLACES_API_KEY are configured;
 * tests inject a fake `fetch`. Upstream URLs carry the key as a query
 * parameter, so they are never logged or put into error messages.
 */
import { extractIndianAddress } from "./india";
import { PlacesProviderError, type PlaceSuggestion, type PlacesProvider, type ReverseResult, type SearchOptions, type SearchResult } from "./places.types";

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const TIMEOUT_MS = 6_000;
const OSM_ATTRIBUTION = { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const validCoord = (lat: number | null, lng: number | null): lat is number => lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/** Metres between two points (haversine), rounded. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

const strings = (o: Record<string, unknown> | undefined): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));

/**
 * City / state / PIN for one result. Indian results use the Indian rules
 * (canonical states and UTs, Delhi without a state field, wards and talukas
 * rejected as cities); other countries keep the provider's fields.
 */
function addressParts(input: { displayName: string; name: string | null; category: string | null; type: string | null; address: Record<string, string | undefined>; countryCode: string | null }) {
  if (!input.countryCode || input.countryCode.toLowerCase() === "in") return extractIndianAddress(input);
  const a = input.address;
  return { city: str(a.city) ?? str(a.town) ?? str(a.village), state: str(a.state), postalCode: str(a.postcode) };
}

async function getJson(fetchImpl: FetchLike, url: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { signal: combined, headers: { Accept: "application/json" } });
  } catch {
    throw new PlacesProviderError(timeout.aborted ? "timeout" : "unavailable");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function failFor(status: number): never {
  if (status === 401 || status === 403) throw new PlacesProviderError("auth", status);
  if (status === 429) throw new PlacesProviderError("rate_limited", status);
  throw new PlacesProviderError("unavailable", status);
}

/* ─── LocationIQ (docs.locationiq.com/docs/autocomplete) ─────────────────── */

interface LocationIqItem {
  class?: unknown;
  type?: unknown;
  place_id?: unknown;
  osm_id?: unknown;
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
  display_place?: unknown;
  display_address?: unknown;
  address?: Record<string, unknown>;
}

export function normaliseLocationIq(body: unknown): PlaceSuggestion[] {
  if (!Array.isArray(body)) throw new PlacesProviderError("bad_response");
  const out: PlaceSuggestion[] = [];
  for (const raw of body as LocationIqItem[]) {
    const lat = num(raw.lat);
    const lng = num(raw.lon);
    if (!validCoord(lat, lng)) continue;
    const a = raw.address ?? {};
    const address = str(raw.display_name) ?? [str(raw.display_place), str(raw.display_address)].filter(Boolean).join(", ");
    const name = str(raw.display_place) ?? str(a.name) ?? address.split(",")[0]?.trim() ?? "";
    if (!name || !address) continue;
    out.push({
      providerPlaceId: String(raw.place_id ?? raw.osm_id ?? `${lat},${lng}`),
      name,
      address, // the provider's full address, unchanged
      ...addressParts({ displayName: address, name, category: str(raw.class), type: str(raw.type), address: strings(a), countryCode: str(a.country_code) }),
      country: str(a.country),
      lat,
      lng: lng as number,
    });
  }
  return out;
}

export function locationIqProvider(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): PlacesProvider {
  const id = "locationiq";
  const attribution = [{ text: "Search by LocationIQ", url: "https://locationiq.com/" }, OSM_ATTRIBUTION];
  return {
    id,
    attribution,
    async autocomplete(query: string, o: SearchOptions): Promise<SearchResult> {
      const params = new URLSearchParams({ key: apiKey, q: query, limit: String(o.limit), countrycodes: o.country, normalizecity: "1", dedupe: "1", "accept-language": "en" });
      const { status, body } = await getJson(fetchImpl, `https://api.locationiq.com/v1/autocomplete?${params}`, o.signal);
      // LocationIQ answers 404 "Unable to geocode" when nothing matches.
      if (status === 404) return { provider: id, attribution, results: [] };
      if (status < 200 || status >= 300) failFor(status);
      return { provider: id, attribution, results: normaliseLocationIq(body) };
    },
    async reverse(lat: number, lng: number, o: { signal?: AbortSignal }): Promise<ReverseResult> {
      const params = new URLSearchParams({ key: apiKey, lat: String(lat), lon: String(lng), format: "json", normalizecity: "1", "accept-language": "en" });
      const { status, body } = await getJson(fetchImpl, `https://api.locationiq.com/v1/reverse?${params}`, o.signal);
      if (status === 404) return { provider: id, attribution, place: null, distanceM: null };
      if (status < 200 || status >= 300) failFor(status);
      const place = normaliseLocationIqReverse(body);
      return { provider: id, attribution, place, distanceM: place ? metresBetween({ lat, lng }, place) : null };
    },
  };
}

/** One LocationIQ /v1/reverse object → PlaceSuggestion (name = first part of the address). */
export function normaliseLocationIqReverse(body: unknown): PlaceSuggestion | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PlacesProviderError("bad_response");
  const raw = body as LocationIqItem;
  const lat = num(raw.lat);
  const lng = num(raw.lon);
  const address = str(raw.display_name);
  if (!validCoord(lat, lng) || !address) return null;
  const a = raw.address ?? {};
  const name = address.split(",")[0]?.trim() || address;
  return {
    providerPlaceId: String(raw.place_id ?? raw.osm_id ?? `${lat},${lng}`),
    name,
    address,
    ...addressParts({ displayName: address, name, category: null, type: null, address: strings(a), countryCode: str(a.country_code) }),
    country: str(a.country),
    lat,
    lng: lng as number,
  };
}

/* ─── Geoapify (apidocs.geoapify.com/docs/geocoding/address-autocomplete) ── */

interface GeoapifyItem {
  result_type?: unknown;
  country_code?: unknown;
  state_district?: unknown;
  hamlet?: unknown;
  place_id?: unknown;
  name?: unknown;
  formatted?: unknown;
  address_line1?: unknown;
  city?: unknown;
  town?: unknown;
  village?: unknown;
  county?: unknown;
  state?: unknown;
  postcode?: unknown;
  country?: unknown;
  lat?: unknown;
  lon?: unknown;
}

export function normaliseGeoapify(body: unknown): PlaceSuggestion[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw new PlacesProviderError("bad_response");
  const out: PlaceSuggestion[] = [];
  for (const raw of results as GeoapifyItem[]) {
    const lat = num(raw.lat);
    const lng = num(raw.lon);
    if (!validCoord(lat, lng)) continue;
    const address = str(raw.formatted);
    const name = str(raw.name) ?? str(raw.address_line1) ?? address?.split(",")[0]?.trim() ?? null;
    if (!name || !address) continue;
    const resultType = str(raw.result_type);
    out.push({
      providerPlaceId: String(raw.place_id ?? `${lat},${lng}`),
      name,
      address,
      ...addressParts({
        displayName: address,
        name,
        category: resultType === "city" || resultType === "suburb" ? "place" : null,
        type: resultType,
        address: strings({ city: raw.city, town: raw.town, village: raw.village, hamlet: raw.hamlet, county: raw.county, state_district: raw.state_district, state: raw.state, postcode: raw.postcode }),
        countryCode: str(raw.country_code),
      }),
      country: str(raw.country),
      lat,
      lng: lng as number,
    });
  }
  return out;
}

export function geoapifyProvider(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): PlacesProvider {
  const id = "geoapify";
  const attribution = [{ text: "Powered by Geoapify", url: "https://www.geoapify.com/" }, OSM_ATTRIBUTION];
  return {
    id,
    attribution,
    async autocomplete(query: string, o: SearchOptions): Promise<SearchResult> {
      const params = new URLSearchParams({ text: query, limit: String(o.limit), filter: `countrycode:${o.country}`, lang: "en", format: "json", apiKey });
      const { status, body } = await getJson(fetchImpl, `https://api.geoapify.com/v1/geocode/autocomplete?${params}`, o.signal);
      if (status < 200 || status >= 300) failFor(status);
      return { provider: id, attribution, results: normaliseGeoapify(body) };
    },
  };
}

/* ─── Selection ──────────────────────────────────────────────────────────── */

export type ProviderSetting = "none" | "locationiq" | "geoapify";

export interface ProviderConfig {
  provider: PlacesProvider | null;
  /** Why search is off, for the status endpoint (never includes the key). */
  disabledReason: "not_configured" | "missing_key" | null;
}

function single(setting: Exclude<ProviderSetting, "none">, key: string, fetchImpl?: FetchLike): PlacesProvider {
  return setting === "locationiq" ? locationIqProvider(key, fetchImpl) : geoapifyProvider(key, fetchImpl);
}

/** Failures worth retrying on another provider (not "no results", not bad input). */
const FALLBACK_ON = new Set(["auth", "rate_limited", "unavailable", "timeout", "bad_response"]);

/**
 * Primary provider with an optional fallback. Each answer carries the
 * attribution of the provider that actually produced it.
 */
export function withFallback(primary: PlacesProvider, fallback: PlacesProvider, log: (msg: string) => void = console.warn): PlacesProvider {
  return {
    id: primary.id,
    attribution: primary.attribution,
    fallbackId: fallback.id,
    // Reverse lookups use the primary only (a fallback for them is not enabled).
    ...(primary.reverse ? { reverse: primary.reverse.bind(primary) } : {}),
    async autocomplete(query, options) {
      try {
        return await primary.autocomplete(query, options);
      } catch (err) {
        if (!(err instanceof PlacesProviderError) || !FALLBACK_ON.has(err.reason) || options.signal?.aborted) throw err;
        log(`[places] ${primary.id} ${err.reason}${err.upstreamStatus ? ` HTTP ${err.upstreamStatus}` : ""}; trying ${fallback.id}`);
        return await fallback.autocomplete(query, options);
      }
    },
  };
}

export function providerFromSettings(
  setting: ProviderSetting,
  apiKey: string | undefined,
  fetchImpl?: FetchLike,
  fallbackSetting: ProviderSetting = "none",
  fallbackKey?: string,
): ProviderConfig {
  if (setting === "none") return { provider: null, disabledReason: "not_configured" };
  const key = apiKey?.trim();
  const fbKey = fallbackKey?.trim();
  const fb = fallbackSetting !== "none" && fallbackSetting !== setting && fbKey ? single(fallbackSetting, fbKey, fetchImpl) : null;
  if (!key) return fb ? { provider: fb, disabledReason: null } : { provider: null, disabledReason: "missing_key" };
  const primary = single(setting, key, fetchImpl);
  return { provider: fb ? withFallback(primary, fb) : primary, disabledReason: null };
}
