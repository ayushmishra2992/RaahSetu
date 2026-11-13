/**
 * Provider-independent location search. The rest of RaahSetu only sees these
 * types; each provider adapter (providers.ts) maps its own response into them,
 * so the provider can be swapped by configuration without touching the UI.
 */

/** One autocomplete suggestion, already normalised. Coordinates are WGS84. */
export interface PlaceSuggestion {
  /** Provider's own identifier for the place (opaque; may change between providers). */
  providerPlaceId: string;
  /** Short name: a business, landmark, building or the first address line. */
  name: string;
  /** Full single-line address as returned by the provider. */
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  lat: number;
  lng: number;
}

export interface AttributionLink {
  text: string;
  url: string;
}

export interface SearchOptions {
  /** ISO 3166-1 alpha-2 country filter, lower-case (default "in"). */
  country: string;
  limit: number;
  signal?: AbortSignal;
}

export interface PlacesProvider {
  /** Stable machine name, e.g. "locationiq". */
  readonly id: string;
  /** Attribution the UI must show next to results (provider + data source). */
  readonly attribution: AttributionLink[];
  /** Set when another provider answers if this one fails. */
  readonly fallbackId?: string;
  autocomplete(query: string, options: SearchOptions): Promise<SearchResult>;
  /** Address at a point (optional: providers without it simply don't offer "Use pin's address"). */
  reverse?(lat: number, lng: number, options: { signal?: AbortSignal }): Promise<ReverseResult>;
}

/** Nearest address to a point. The caller's pin is never moved; `distanceM` says how far the match is. */
export interface ReverseResult {
  provider: string;
  attribution: AttributionLink[];
  place: PlaceSuggestion | null;
  /** Metres between the requested point and the matched address point (null when nothing matched). */
  distanceM: number | null;
}

/** Results plus who actually answered (a fallback may answer for the primary). */
export interface SearchResult {
  provider: string;
  attribution: AttributionLink[];
  results: PlaceSuggestion[];
}

/** Why a provider call failed, without any upstream URL (which may carry the key). */
export type ProviderFailure = "auth" | "rate_limited" | "unavailable" | "bad_response" | "timeout";

export class PlacesProviderError extends Error {
  constructor(
    public readonly reason: ProviderFailure,
    public readonly upstreamStatus?: number,
  ) {
    super(`Location search provider failed: ${reason}${upstreamStatus ? ` (HTTP ${upstreamStatus})` : ""}`);
    this.name = "PlacesProviderError";
  }
}
