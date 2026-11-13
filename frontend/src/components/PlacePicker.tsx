"use client";

/**
 * Reusable location picker: search box with live suggestions → map pin the
 * user can drag or click to adjust → manual coordinates as an advanced
 * fallback. Provider-independent: suggestions come from RaahSetu's own
 * /api/places/* endpoints, which hold the provider key server-side.
 *
 * Request economy (all per dialog, in memory only):
 * - debounced; repeated queries come from a cache;
 * - a query that only extends an earlier zero-result query is not sent;
 * - after zero results nothing is sent until the user picks "Broaden search"
 *   or "Search anyway";
 * - "Use pin's address" runs only when clicked, and once per pin position.
 *
 * Works without a provider: the user places the pin on the map (or types
 * coordinates), and saved company locations can still be searched.
 */
import { Building2, Crosshair, Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Alert, Badge, Button, Field, Input } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { resolveTileConfig } from "@/lib/map";
import {
  broadenOptions,
  coordProblem,
  fmtDistanceM,
  localityLine,
  metresBetween,
  normaliseQuery,
  pinKey,
  round6,
  savedMatches,
  SearchCache,
  type AttributionLink,
  type PlaceSearchResponse,
  type PlaceSuggestion,
  type PlacesStatus,
  type PlaceValue,
  type ReverseResponse,
} from "@/lib/places";
import type { Location } from "@/lib/types";
import { useApi } from "@/lib/useApi";

// NEXT_PUBLIC_* values are inlined at build time; they must be referenced literally.
const TILES = resolveTileConfig(process.env.NEXT_PUBLIC_MAP_TILE_URL, process.env.NEXT_PUBLIC_MAP_ATTRIBUTION, process.env.NEXT_PUBLIC_MAP_MAX_ZOOM);

const PinMap = dynamic(() => import("./PinMap"), {
  ssr: false,
  loading: () => <div style={{ height: 260 }} className="grid w-full place-items-center rounded-md border border-line bg-[#f8fbfb] text-sm text-muted">Loading map…</div>,
});

const DEBOUNCE_MS = 300;
/** Saved company locations are matched from this many characters (no request involved). */
const SAVED_MIN = 2;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; query: string; items: PlaceSuggestion[]; provider: string; attribution: AttributionLink[]; skipped?: boolean }
  | { status: "error"; message: string };

type Option = { kind: "saved"; loc: Location } | { kind: "remote"; place: PlaceSuggestion };

type ReverseState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "none" };

const SOURCE_LABEL: Record<PlaceValue["source"], string> = {
  SEARCH: "From search",
  PIN_ADJUSTED: "Pin adjusted",
  MANUAL: "Coordinates entered",
  EXISTING: "Saved location",
};

function Attribution({ links }: { links: AttributionLink[] }) {
  if (!links.length) return null;
  return (
    <p className="text-[11px] text-muted">
      {links.map((l, i) => (
        <span key={l.url}>
          {i > 0 && " · "}
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{l.text}</a>
        </span>
      ))}
    </p>
  );
}

function ManualCoords({ value, onApply }: { value: PlaceValue; onApply: (lat: number, lng: number) => void }) {
  const [lat, setLat] = useState(value.lat?.toString() ?? "");
  const [lng, setLng] = useState(value.lng?.toString() ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Latitude">
        <Input type="number" step="any" min={-90} max={90} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="19.0760" />
      </Field>
      <Field label="Longitude">
        <Input type="number" step="any" min={-180} max={180} inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="72.8777" />
      </Field>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          const a = lat.trim() === "" ? null : Number(lat);
          const b = lng.trim() === "" ? null : Number(lng);
          const p = coordProblem(a, b);
          setProblem(p);
          if (!p) onApply(a as number, b as number);
        }}
      >
        Use coordinates
      </Button>
      {problem && <p className="text-xs font-medium text-danger-600 sm:col-span-3" role="alert">{problem}</p>}
    </div>
  );
}

export function PlacePicker({
  value,
  onChange,
  error,
  label = "Search for a place",
  hint = "Address, landmark, business or warehouse name",
  saved = [],
  onPickSaved,
  onPinAddress,
}: {
  value: PlaceValue;
  onChange: (next: PlaceValue) => void;
  error?: string | null;
  label?: string;
  hint?: string;
  /** The company's existing locations, offered as "Saved locations" (no request needed). */
  saved?: Location[];
  onPickSaved?: (loc: Location) => void;
  /** Receives the address found at the pin; the form shows it as a preview. Enables "Use pin's address". */
  onPinAddress?: (found: ReverseResponse) => void;
}) {
  const status = useApi<PlacesStatus>("/places/status");
  // An older backend without /places, or any status error, means "search off".
  const enabled = !!status.data?.enabled;
  const minLen = status.data?.minQueryLength ?? 3;
  const canReverse = enabled && !!status.data?.reverse && !!onPinAddress;
  const offerSaved = !!onPickSaved && saved.length > 0;

  const [query, setQuery] = useState(value.place?.provider === "saved" ? "" : (value.place?.name ?? ""));
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [forced, setForced] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  // Bumped whenever the value changes from outside the manual inputs, so they re-seed.
  const [revision, setRevision] = useState(0);
  // Whether the pin has been moved by hand since the last search choice (shows "Use pin's address").
  const [pinMoved, setPinMoved] = useState(false);
  const [reverse, setReverse] = useState<ReverseState>({ status: "idle" });
  const seq = useRef(0);
  const cache = useRef(new SearchCache());
  const reverseCache = useRef(new Map<string, ReverseResponse>());
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const q = normaliseQuery(query);
  const remoteActive = enabled && q.length >= minLen;

  // Debounced search: cache hits and dead-end extensions are answered without a request.
  useEffect(() => {
    if (!remoteActive || !open) return;
    const mine = ++seq.current;
    const cached = cache.current.get(q);
    const skip = !cached && forced !== q && cache.current.extendsDeadEnd(q);
    const t = window.setTimeout(
      () => {
        if (cached || skip) {
          setSearch(cached ? { status: "done", query: q, items: cached.results, provider: cached.provider, attribution: cached.attribution } : { status: "done", query: q, items: [], provider: "", attribution: [], skipped: true });
          return;
        }
        setSearch({ status: "loading" });
        api<PlaceSearchResponse>(`/places/autocomplete?q=${encodeURIComponent(q)}`).then(
          (r) => {
            cache.current.set(q, r);
            if (mine !== seq.current) return;
            setSearch({ status: "done", query: q, items: r.results, provider: r.provider, attribution: r.attribution });
          },
          (e: unknown) => {
            if (mine === seq.current) setSearch({ status: "error", message: errorMessage(e) });
          },
        );
      },
      cached || skip ? 0 : DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [q, remoteActive, open, forced]);

  const savedItems = useMemo(() => (offerSaved && q.length >= SAVED_MIN ? savedMatches(q, saved) : []), [offerSaved, q, saved]);
  const remoteItems = remoteActive && search.status === "done" && search.query === q ? search.items : [];
  const options: Option[] = [...savedItems.map((loc) => ({ kind: "saved" as const, loc })), ...remoteItems.map((place) => ({ kind: "remote" as const, place }))];
  const remoteBusy = remoteActive && (search.status === "loading" || (search.status === "done" && search.query !== q));
  const showList = open && (savedItems.length > 0 || (remoteActive && search.status !== "idle"));
  const activeIndex = active >= 0 && active < options.length ? active : options.length ? 0 : -1;

  const choose = useCallback(
    (s: PlaceSuggestion, provider: string) => {
      seq.current += 1; // ignore any search still in flight
      setQuery(s.name);
      setOpen(false);
      setActive(-1);
      setRevision((r) => r + 1);
      setPinMoved(false);
      setReverse({ status: "idle" });
      onChange({ lat: round6(s.lat), lng: round6(s.lng), source: "SEARCH", place: { ...s, provider } });
    },
    [onChange],
  );

  function chooseOption(o: Option) {
    if (o.kind === "saved") {
      setOpen(false);
      setActive(-1);
      onPickSaved?.(o.loc);
    } else if (search.status === "done") {
      choose(o.place, search.provider);
    }
  }

  const pick = useCallback(
    (lat: number, lng: number, how: "drag" | "click" | "manual") => {
      setRevision((r) => r + 1);
      setPinMoved(true);
      setReverse({ status: "idle" });
      onChange({
        lat: round6(lat),
        lng: round6(lng),
        source: how === "manual" ? "MANUAL" : value.place ? "PIN_ADJUSTED" : "MANUAL",
        place: value.place ?? null,
      });
    },
    [onChange, value.place],
  );
  const onPinPick = useCallback((lat: number, lng: number, how: "drag" | "click") => pick(lat, lng, how), [pick]);
  const onTilesFailed = useCallback(() => {
    setTilesFailed(true);
    setManualOpen(true);
  }, []);

  async function lookUpPinAddress() {
    if (value.lat === null || value.lng === null || !onPinAddress) return;
    const k = pinKey(value.lat, value.lng);
    const hit = reverseCache.current.get(k);
    if (hit) {
      setReverse(hit.place ? { status: "idle" } : { status: "none" });
      if (hit.place) onPinAddress(hit);
      return;
    }
    setReverse({ status: "loading" });
    try {
      const r = await api<ReverseResponse>(`/places/reverse?lat=${value.lat}&lng=${value.lng}`);
      reverseCache.current.set(k, r);
      setReverse(r.place ? { status: "idle" } : { status: "none" });
      if (r.place) onPinAddress(r);
    } catch (e) {
      setReverse({ status: "error", message: errorMessage(e) });
    }
  }

  function retype(next: string) {
    setQuery(next);
    setOpen(true);
    setActive(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((activeIndex + 1) % options.length);
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setActive(activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
    } else if (e.key === "Enter" && showList) {
      // Never submit the surrounding form from the search box.
      e.preventDefault();
      if (activeIndex >= 0 && options[activeIndex]) chooseOption(options[activeIndex]);
    } else if (e.key === "Escape" && showList) {
      e.preventDefault();
      setOpen(false);
    }
  }

  const moved = value.place && value.lat !== null && value.lng !== null ? metresBetween(value.place, { lat: value.lat, lng: value.lng }) : 0;
  const hasPin = value.lat !== null && value.lng !== null;
  const mapAvailable = !!TILES.url && !tilesFailed;
  const noMatches = remoteActive && search.status === "done" && search.query === q && search.items.length === 0;
  const broaden = noMatches ? broadenOptions(q) : [];
  const showSearchBox = enabled || offerSaved;

  const renderOption = (o: Option, i: number) => (
    <div
      key={o.kind === "saved" ? `saved-${o.loc.id}` : `remote-${o.place.providerPlaceId}-${i}`}
      id={optionId(i)}
      role="option"
      aria-selected={i === activeIndex}
      className={`flex cursor-pointer gap-2.5 px-3 py-2 text-sm ${i === activeIndex ? "bg-brand-50" : "hover:bg-canvas"}`}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setActive(i)}
      onClick={() => chooseOption(o)}
    >
      {o.kind === "saved" ? <Building2 className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden /> : <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />}
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{o.kind === "saved" ? o.loc.name : o.place.name}</span>
        <span className="block truncate text-xs text-muted">{o.kind === "saved" ? [o.loc.address, o.loc.postalCode].filter(Boolean).join(" · ") || `${o.loc.lat.toFixed(4)}, ${o.loc.lng.toFixed(4)}` : o.place.address}</span>
      </span>
    </div>
  );

  return (
    <div className="space-y-3" data-testid="place-picker">
      {status.loading ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Checking location search…</p>
      ) : (
        <>
          {!enabled && (
            <Alert kind="info" title="Address search isn’t set up">
              Click the map to drop a pin, then drag it to the exact spot. You can also enter coordinates under “Advanced”.
              {status.data?.reason === "missing_key" ? " (A search provider is selected on the server but its API key is missing.)" : ""}
            </Alert>
          )}
          {showSearchBox && (
            <div className="relative">
              <Field label={enabled ? label : "Search saved locations"} hint={enabled ? hint : "Your company’s existing locations"}>
                <Input
                  ref={inputRef}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showList}
                  aria-controls={listId}
                  aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  placeholder={enabled ? "e.g. Bhiwandi warehouse, Andheri East, 400059" : "Name, address or PIN"}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setActive(-1);
                    if (normaliseQuery(e.target.value).length < minLen) setSearch({ status: "idle" });
                  }}
                  onFocus={() => q.length >= SAVED_MIN && setOpen(true)}
                  onBlur={() => window.setTimeout(() => setOpen(false), 150)}
                  onKeyDown={onKeyDown}
                />
              </Field>
              <Search className="pointer-events-none absolute right-3 top-[34px] size-4 text-muted" aria-hidden />
              {showList && (
                <div className="absolute inset-x-0 z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
                  <div id={listId} role="listbox" aria-label="Suggestions" className="max-h-80 overflow-y-auto">
                    {savedItems.length > 0 && (
                      <div role="group" aria-label="Saved locations">
                        <div role="presentation" className="bg-canvas px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Saved locations</div>
                        {options.map((o, i) => (o.kind === "saved" ? renderOption(o, i) : null))}
                      </div>
                    )}
                    {remoteItems.length > 0 && (
                      <div role="group" aria-label="Search results">
                        {savedItems.length > 0 && <div role="presentation" className="bg-canvas px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Search results</div>}
                        {options.map((o, i) => (o.kind === "remote" ? renderOption(o, i) : null))}
                      </div>
                    )}
                  </div>
                  {remoteBusy && <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted" role="status"><Loader2 className="size-4 animate-spin" aria-hidden /> Searching…</p>}
                  {remoteActive && search.status === "error" && <p className="px-3 py-2.5 text-sm text-danger-700" role="alert">{search.message}</p>}
                  {noMatches && search.status === "done" && (
                    <div className="space-y-2 px-3 py-2.5 text-sm text-muted" role="status">
                      <p>
                        {search.skipped ? "No matches: a shorter version of this search found nothing, so it wasn’t sent again." : "No matches."} Try another spelling, a nearby landmark or the PIN code, or place the pin on the map.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {broaden.map((b) => (
                          <Button key={b} type="button" size="sm" variant="secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => retype(b)}>
                            Broaden search: “{b}”
                          </Button>
                        ))}
                        {search.skipped && (
                          <Button type="button" size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => { setForced(q); setOpen(true); }}>
                            Search anyway
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {remoteItems.length > 0 && search.status === "done" && <div className="border-t border-line px-3 py-1.5"><Attribution links={search.attribution} /></div>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {hasPin && (
        <div className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{value.place?.name ?? "Pinned location"}</span>
            <Badge color={value.source === "SEARCH" ? "teal" : value.source === "PIN_ADJUSTED" ? "amber" : "gray"}>{SOURCE_LABEL[value.source]}</Badge>
          </div>
          {value.place && <p className="mt-0.5 text-muted">{value.place.address}</p>}
          {value.place && localityLine(value.place) && (
            <p className="mt-0.5 text-xs text-muted">
              {[value.place.city && `City: ${value.place.city}`, value.place.state && `State: ${value.place.state}`, value.place.postalCode && `PIN: ${value.place.postalCode}`].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="tabular mt-0.5 text-xs text-muted">
            {value.lat?.toFixed(6)}, {value.lng?.toFixed(6)}
            {value.source === "PIN_ADJUSTED" && moved >= 1 && ` · moved ${fmtDistanceM(moved)} from the ${value.place?.provider === "saved" ? "saved position" : "search result"}`}
          </p>
          {canReverse && pinMoved && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" icon={LocateFixed} loading={reverse.status === "loading"} onClick={lookUpPinAddress}>
                {reverse.status === "loading" ? "Looking up address…" : "Use pin’s address"}
              </Button>
              {reverse.status === "none" && <span className="text-xs text-muted" role="status">No address found near the pin. Type the address below.</span>}
              {reverse.status === "error" && <span className="text-xs font-medium text-danger-700" role="alert">{reverse.message}</span>}
            </div>
          )}
        </div>
      )}

      {mapAvailable ? (
        <div>
          <PinMap lat={value.lat} lng={value.lng} onPick={onPinPick} height={260} tiles={{ ...TILES, url: TILES.url as string }} onTilesFailed={onTilesFailed} label="Location map: click to place the pin, drag the pin to adjust" />
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <Crosshair className="size-3.5" aria-hidden />
            {hasPin ? "Drag the pin (or click the map) to fine-tune the exact gate or dock." : "Click the map to drop a pin."}
          </p>
        </div>
      ) : (
        <p className="text-xs text-amber-700">{TILES.url ? "The map could not be loaded (offline or blocked)." : "Map tiles are disabled."} Enter coordinates below.</p>
      )}

      <details open={manualOpen} onToggle={(e) => setManualOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-lg border border-line px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-ink">Advanced: enter coordinates manually</summary>
        <p className="mt-1 text-xs text-muted">Only if search and the map can’t find the spot. Decimal degrees (WGS84), e.g. from a GPS device.</p>
        <ManualCoords key={revision} value={value} onApply={(a, b) => pick(a, b, "manual")} />
      </details>

      {error && <p className="text-xs font-medium text-danger-600" role="alert">{error}</p>}
    </div>
  );
}
