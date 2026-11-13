"use client";

/**
 * Create / edit a Location (POST /locations, PATCH /locations/:id) with the
 * PlacePicker. Shared by Locations & Roads and the inline "New location"
 * dialogs on the order and vehicle forms.
 *
 * Address rules:
 * - A search result fills empty fields (and fields it filled before) at once.
 *   Values the user typed or that were already saved are never replaced
 *   silently: differences are offered in a preview with one checkbox per field.
 * - "Use pin's address" always goes through that preview, shows the distance
 *   to the matched address, and never moves the pin.
 * - The provider's full address is kept as returned; city, state and PIN are
 *   separate, editable fields.
 */
import { CheckCircle2, MapPinned } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Alert, Button, Dialog, Field, Input, Select } from "@/components/ds";
import { FormShell } from "@/components/forms";
import { PlacePicker } from "@/components/PlacePicker";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { canonicalRegion, indianPin, INDIAN_STATES_AND_UTS, pinProblem } from "@/lib/india";
import { coordProblem, findDuplicates, fmtDistanceM, locationFieldsFromPlace, type DuplicateMatch, type PlaceSuggestion, type PlaceValue, type ReverseResponse } from "@/lib/places";
import type { Location, RoadNode } from "@/lib/types";

/**
 * Picker value for a saved location. Saved search details are shown (as
 * provider "saved") so the summary and the "moved by" note keep working.
 */
function existingPlace(loc: Location): PlaceValue {
  const hasDetails = !!(loc.city || loc.state || loc.postalCode || loc.placeProvider);
  return {
    lat: loc.lat,
    lng: loc.lng,
    source: "EXISTING",
    place: hasDetails
      ? { provider: "saved", providerPlaceId: loc.providerPlaceId ?? "", name: loc.name, address: loc.address ?? "", city: loc.city ?? null, state: loc.state ?? null, postalCode: loc.postalCode ?? null, country: loc.country ?? null, lat: loc.lat, lng: loc.lng }
      : null,
  };
}

export const LOCATION_TYPES = ["DEPOT", "WAREHOUSE", "CUSTOMER", "OTHER"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/** Text fields that a search result or the pin's address can fill. */
const ADDRESS_FIELDS = ["name", "address", "city", "state", "postalCode"] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];
const FIELD_LABEL: Record<AddressField, string> = { name: "Name", address: "Address", city: "City", state: "State / UT", postalCode: "PIN code" };
const MAX_LEN: Record<AddressField, number> = { name: 120, address: 300, city: 100, state: 100, postalCode: 12 };

type Draft = Record<AddressField, string> & { type: string; roadNodeId: string };
type Errors = Partial<Record<AddressField, string>>;

/** Values a provider result offers for each field (state canonical, PIN validated). */
function offered(p: PlaceSuggestion): Record<AddressField, string> {
  return {
    name: p.name.slice(0, MAX_LEN.name),
    address: p.address.slice(0, MAX_LEN.address),
    city: (p.city ?? "").slice(0, MAX_LEN.city),
    state: canonicalRegion(p.state) ?? "",
    postalCode: indianPin(p.postalCode) ?? "",
  };
}

interface Preview {
  origin: "pin" | "search";
  place: PlaceSuggestion;
  distanceM: number | null;
  /** Fields whose offered value differs from the form, with the checkbox state. */
  rows: Array<{ field: AddressField; current: string; next: string; checked: boolean; manual: boolean }>;
}

export type ExistingAction = "select" | "edit";

export function LocationForm({
  loc,
  nodes,
  defaultType = "CUSTOMER",
  existing = [],
  existingAction,
  onUseExisting,
  onSaved,
}: {
  loc?: Location;
  /** Road nodes for the "nearest road node" choice; omit to hide it (automatic snapping). */
  nodes?: RoadNode[];
  defaultType?: LocationType;
  /** The company's locations: offered as "Saved locations" and checked for duplicates. */
  existing?: Location[];
  /** "select": use the existing location instead (order/vehicle forms). "edit": open it for editing (Locations page). */
  existingAction?: ExistingAction;
  onUseExisting?: (loc: Location) => void;
  onSaved: (saved: Location) => void;
}) {
  const [f, setF] = useState<Draft>({
    name: loc?.name ?? "",
    address: loc?.address ?? "",
    city: loc?.city ?? "",
    state: loc?.state ?? "",
    postalCode: loc?.postalCode ?? "",
    type: loc?.type ?? defaultType,
    roadNodeId: loc?.roadNodeId?.toString() ?? "",
  });
  const [place, setPlace] = useState<PlaceValue>(() => (loc ? existingPlace(loc) : { lat: null, lng: null, source: "MANUAL", place: null }));
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateMatch[] | null>(null);
  // Values last filled automatically; a field equal to its entry may be replaced by the next result.
  const autoFilled = useRef<Record<AddressField, string>>({ name: "", address: "", city: "", state: "", postalCode: "" });
  // Set by "Save as a new location anyway" just before the form submits.
  const saveAnyway = useRef(false);
  const others = useMemo(() => existing.filter((l) => l.id !== loc?.id), [existing, loc?.id]);
  const reuse = existingAction && onUseExisting ? onUseExisting : undefined;

  const isManual = (k: AddressField, current: string) => current.trim() !== "" && current !== autoFilled.current[k];

  function setField(k: keyof Draft, v: string) {
    setF((s) => ({ ...s, [k]: v }));
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }));
    if (k === "name") setDupes(null);
    setApplied(null);
  }
  const bind = (k: keyof Draft) => (e: { target: { value: string } }) => setField(k, e.target.value);

  function buildPreview(origin: Preview["origin"], p: PlaceSuggestion, distanceM: number | null, current: Draft): Preview {
    const next = offered(p);
    const rows = ADDRESS_FIELDS.filter((k) => next[k] && next[k] !== current[k]).map((k) => {
      const manual = isManual(k, current[k]);
      // Empty or previously auto-filled fields are ticked; anything typed or saved needs a tick from the user.
      return { field: k, current: current[k], next: next[k], manual, checked: !manual && !(k === "name" && origin === "pin" && current.name.trim() !== "") };
    });
    return { origin, place: p, distanceM, rows };
  }

  function applyRows(rows: Preview["rows"]) {
    const chosen = rows.filter((r) => r.checked);
    if (!chosen.length) return;
    setF((s) => {
      const out = { ...s };
      for (const r of chosen) {
        out[r.field] = r.next;
        autoFilled.current[r.field] = r.next;
      }
      return out;
    });
    setErrors((e) => {
      const out = { ...e };
      for (const r of chosen) delete out[r.field];
      return out;
    });
  }

  function onPlace(next: PlaceValue) {
    const movedPin = next.lat !== place.lat || next.lng !== place.lng;
    setPlace(next);
    setPlaceError(null);
    if (movedPin) {
      setDupes(null);
      setApplied(null);
      if (preview?.origin === "pin") setPreview(null);
    }
    if (next.source === "SEARCH" && next.place) {
      // Fill what's empty or auto-filled now; offer the rest.
      const p = buildPreview("search", next.place, null, f);
      applyRows(p.rows.filter((r) => r.checked));
      const conflicts = p.rows.filter((r) => !r.checked);
      setPreview(conflicts.length ? { ...p, rows: conflicts } : null);
    }
  }

  function onPinAddress(found: ReverseResponse) {
    if (!found.place) return;
    setApplied(null);
    setPreview(buildPreview("pin", found.place, found.distanceM, f));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (f.name.trim().length < 2) e.name = "Give the location a name (at least 2 characters).";
    const pin = pinProblem(f.postalCode);
    if (pin) e.postalCode = pin;
    if (f.state && !canonicalRegion(f.state)) e.state = "Choose a state or union territory from the list.";
    return e;
  }

  const stateOptions = f.state && !INDIAN_STATES_AND_UTS.includes(f.state) ? [f.state, ...INDIAN_STATES_AND_UTS] : INDIAN_STATES_AND_UTS;
  const previewChecked = preview?.rows.some((r) => r.checked) ?? false;

  return (
    <FormShell
      submitLabel={loc ? "Save changes" : "Add location"}
      onSubmit={async () => {
        const problem = coordProblem(place.lat, place.lng);
        setPlaceError(problem);
        const e = validate();
        setErrors(e);
        if (problem) throw new Error(problem);
        const n = Object.keys(e).length;
        if (n) throw new Error(n === 1 ? Object.values(e)[0]! : `Fix the ${n} highlighted fields and try again.`);
        const coords = locationFieldsFromPlace(place, { isNew: !loc })!;

        // Possible duplicates: ask once; "Save as a new location anyway" confirms.
        const coordsChanged = !loc || coords.lat !== loc.lat || coords.lng !== loc.lng || f.name.trim() !== loc.name;
        if (coordsChanged && !saveAnyway.current) {
          const found = findDuplicates({ name: f.name.trim(), lat: coords.lat, lng: coords.lng, placeProvider: coords.placeProvider, providerPlaceId: coords.providerPlaceId }, others);
          if (found.length) {
            setDupes(found);
            return;
          }
        }
        saveAnyway.current = false;

        const body: Record<string, unknown> = {
          name: f.name.trim(),
          type: f.type,
          address: f.address.trim() || null,
          ...coords,
          // The editable fields are the source of truth (they may have been corrected by hand).
          city: f.city.trim() || null,
          state: canonicalRegion(f.state) ?? null,
          postalCode: indianPin(f.postalCode),
        };
        if (nodes) body.roadNodeId = f.roadNodeId ? Number(f.roadNodeId) : null;
        const saved = await api<Location>(loc ? `/locations/${loc.id}` : "/locations", { method: loc ? "PATCH" : "POST", body });
        onSaved(saved);
      }}
    >
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-ink">Where is it?</legend>
        <PlacePicker
          value={place}
          onChange={onPlace}
          error={placeError}
          saved={others}
          onPickSaved={(l) => {
            if (existingAction === "select" && reuse) reuse(l);
            else setDupes([{ location: l, distanceM: 0, reasons: [] }]);
          }}
          onPinAddress={onPinAddress}
        />
      </fieldset>

      {preview && (
        <section aria-label={preview.origin === "pin" ? "Address at the pin" : "Search result details"} className="rounded-lg border border-accent-400/40 bg-accent-100/40 px-3 py-3 text-sm">
          <h3 className="flex items-center gap-1.5 font-medium text-ink">
            <MapPinned className="size-4 text-brand-700" aria-hidden />
            {preview.origin === "pin" ? "Address at the pin" : "The search result differs from what you entered"}
          </h3>
          <p className="mt-1 text-ink">{preview.place.address}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr]">
            <dt>City</dt>
            <dd className="text-ink">{preview.place.city ?? "—"}</dd>
            <dt>State / UT</dt>
            <dd className="text-ink">{canonicalRegion(preview.place.state) ?? "—"}</dd>
            <dt>PIN</dt>
            <dd className="text-ink">{indianPin(preview.place.postalCode) ?? "—"}</dd>
          </dl>
          {preview.origin === "pin" && preview.distanceM !== null && (
            <p className="mt-1 text-xs text-muted">This address is {fmtDistanceM(preview.distanceM)} from your pin. The pin stays where you put it.</p>
          )}
          {preview.rows.length ? (
            <fieldset className="mt-2 min-w-0 space-y-1.5">
              <legend className="mb-1 text-xs font-medium text-ink">Choose what to fill in:</legend>
              {preview.rows.map((r, i) => (
                <label key={r.field} className="flex min-w-0 items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-brand-600"
                    checked={r.checked}
                    onChange={(e) => setPreview((p) => (p ? { ...p, rows: p.rows.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)) } : p))}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{FIELD_LABEL[r.field]}</span>: <span className="break-words text-ink">{r.next}</span>
                    {r.current.trim() && <span className="block break-words text-muted">replaces “{r.current}”{r.manual ? " (entered by you)" : ""}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="mt-2 text-xs text-muted">The form already matches this address.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {preview.rows.length > 0 && (
              <Button
                type="button"
                size="sm"
                disabled={!previewChecked}
                onClick={() => {
                  applyRows(preview.rows);
                  setApplied(preview.origin === "pin" ? "Address filled in from the pin. The pin was not moved." : "Selected details filled in from the search result.");
                  setPreview(null);
                }}
              >
                Apply selected
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
              {preview.rows.length ? "Keep my values" : "Close"}
            </Button>
          </div>
        </section>
      )}
      {applied && (
        <p className="flex items-center gap-1.5 text-sm text-success-700" role="status">
          <CheckCircle2 className="size-4" aria-hidden /> {applied}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required hint="Filled from the search result; edit freely" error={errors.name}>
          <Input required minLength={2} maxLength={MAX_LEN.name} value={f.name} onChange={bind("name")} />
        </Field>
        <Field label="Type" hint="Depots are where vehicles start and end routes">
          <Select value={f.type} onChange={bind("type")}>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>{humanize(t)}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address" hint="Kept exactly as the search returned it; edit if needed" error={errors.address}>
            <Input maxLength={MAX_LEN.address} value={f.address} onChange={bind("address")} />
          </Field>
        </div>
        <Field label="City" error={errors.city}>
          <Input maxLength={MAX_LEN.city} value={f.city} onChange={bind("city")} autoComplete="address-level2" />
        </Field>
        <Field label="State / UT" error={errors.state}>
          <Select value={f.state} onChange={bind("state")}>
            <option value="">Not set</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="PIN code" hint="6 digits" error={errors.postalCode}>
          <Input inputMode="numeric" autoComplete="postal-code" maxLength={7} value={f.postalCode} onChange={bind("postalCode")} placeholder="400059" />
        </Field>
        {nodes && (
          <div className="sm:col-span-2">
            <Field label="Nearest road node" hint="Leave on automatic to snap to the nearest node">
              <Select value={f.roadNodeId} onChange={bind("roadNodeId")}>
                <option value="">Automatic (nearest)</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      {dupes && dupes.length > 0 && (
        <Alert kind="warning" title={dupes[0].reasons.length ? "This may already be saved" : "Already saved"}>
          <ul className="mt-1 space-y-1.5">
            {dupes.slice(0, 3).map((d) => (
              <li key={d.location.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  <strong>{d.location.name}</strong>
                  {d.reasons.length > 0 && ` · ${fmtDistanceM(d.distanceM)} away${d.reasons.includes("same name nearby") ? " · same name" : ""}${d.reasons.includes("same place") ? " · same search result" : ""}`}
                </span>
                {reuse && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => reuse(d.location)}>
                    {existingAction === "select" ? "Use this location" : "Edit it instead"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {dupes[0].reasons.length > 0 && (
            <div className="mt-2">
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                onClick={() => {
                  saveAnyway.current = true;
                }}
              >
                {loc ? "Save anyway" : "Save as a new location anyway"}
              </Button>
            </div>
          )}
        </Alert>
      )}
    </FormShell>
  );
}

/** "New location" dialog used from other forms; reports the created (or reused) location. */
export function NewLocationDialog({
  open,
  onClose,
  onCreated,
  existing,
  defaultType,
  title = "New location",
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the new location, or with an existing one the user chose to reuse. */
  onCreated: (loc: Location) => void;
  existing?: Location[];
  defaultType?: LocationType;
  title?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description="Search for the address or business, or pick one of your saved locations." size="lg">
      {open && (
        <LocationForm
          defaultType={defaultType}
          existing={existing}
          existingAction="select"
          onUseExisting={(loc) => {
            onCreated(loc);
            onClose();
          }}
          onSaved={(loc) => {
            onCreated(loc);
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}
