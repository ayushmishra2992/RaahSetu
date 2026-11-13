# Implementation history

A record of how the current version of RaahSetu was built: the principles the work followed, what each phase delivered, the API gaps that remain, and the research behind location search. For how the system works today, see [ARCHITECTURE.md](../ARCHITECTURE.md); for current test results, see [TESTING.md](../TESTING.md).

## Principles

- **Real data only.** Every number on screen comes from an API response or is arithmetic over one (for example, a sum of listed invoice totals). Estimates are labelled as estimates and simulated vehicle positions as simulated.
- **Frontend first, API changes documented.** The UI work in phases 3–8 did not change the database or API contract. Where a feature needed data the API does not expose, the gap was recorded (G1–G4 below) together with the smallest change that would close it.
- **Mirror backend rules in the UI** (order, billing, password and company-settings validation) for instant feedback, while the backend stays authoritative.
- **Additive database changes only.** The one schema change made in this round (location-search details) adds nullable columns and an enum with a default.

## Phase log

### Phase 3 — Control Tower
- KPI row (utilisation, on-time, trips, planned km, estimated cost, estimated CO₂) with each KPI's definition; permission-aware quick actions; critical-alert banner.
- Live operations map with status tabs and per-trip progress (simulated positions, labelled); alerts with severity tabs; fleet, driver, order and trip status bars.
- Panels for orders past their delivery window, compliance expiries within the company alert window, recent activity (admins and managers), fuel and emissions for 7/30/90 days (estimated vs logged kept separate) and recent OptiRoute runs.
- New dependency-free chart components (`ds/Charts.tsx`) with text summaries for screen readers; readable audit descriptions (`lib/audit.ts`).

### Phase 4 — OptiRoute
- Planner with steps (orders → vehicles → constraints and objective → run), searchable and filterable selections, pre-flight checks (`preflight.ts`: missing depot, over-heavy orders, windows closing before plan start), server errors with retry, sticky run bar on phones.
- Run detail tabs: overview (map, feasibility, per-vehicle utilisation, objective breakdown, convergence chart), routes, unserved & exclusions with reasons, assumptions. Copy states that a plan is the best the heuristic found, not a proven optimum.
- Run comparison with deltas judged per metric (`compare.ts`), so "more orders served" reads as better.

### Phase 5 — Orders, trips and dispatch
- Orders: status tabs, search, priority filter, deep-linkable detail drawer with linked trips, editing of pending orders, cancellation with a consequence-stating confirmation, field validation mirroring the backend.
- Trips: lifecycle stepper, stop timeline (cards on phones), status history, QR dialog, linked billing documents; 409 conflicts explained and the trip reloaded.
- Manual dispatch: vehicle/driver details, licence and depot warnings, load-vs-capacity meter, server 422 reasons shown.

### Phase 6 — Fleet and compliance
- Vehicles and drivers: status summaries, searchable tables, detail pages with compliance, recent trips and fuel log; driver-to-login linking for admins.
- Compliance documents: counts by expiry state, filters, add/renew/delete; copy states that states come from entered dates and nothing is checked against VAHAN, Sarathi or insurers.
- Locations & roads: tabs for locations, road segments (close/reopen, one-way/two-way), road nodes and shortest path.
- Phone layouts: `DataTable` gained a `mobileCard` renderer; main lists render cards below 768 px.

### Phase 7 — Business and administration
- Billing: summary figures computed from listed totals, overdue view, a live totals preview mirroring the backend's rounding and GST rules, printable document with confirmations.
- GreenFleet: estimated vs logged per vehicle, per-job vehicle comparison, fuel log.
- Scenarios: disruption cards with client checks, direction-aware before/after deltas, manager decision.
- Users, audit log (readable sentences, linked records, structured details), sectioned settings; a generic error page; the login page's development hint shown only in development builds.

### Phase 8 — Release readiness
- No page-level horizontal overflow at 390, 768 and 1024 px on all app pages (automated); phone card layouts.
- Automated accessibility subset: one `h1` per page, `lang`, named controls, image `alt`, no console errors; keyboard and focus behaviour covered by shell tests.
- Security: fixed an open redirect after login (`?next=/\evil.example`), verified hardening headers and that the client bundle contains no server secrets.
- Route guard: pages a role cannot open render a "no access" page without calling the API; a browser test checks 5 roles × 15 pages against the backend's permission matrix.
- Performance: 313–367 KB of compressed JavaScript per page including prefetched routes; Leaflet only on map pages; a 450 KB budget test.

### Brand
- Replaced the placeholder "RS" tile with the RaahSetu mark — a location pin whose negative space is a road entering through the tip and ending at an amber destination node — plus SVG lockups, favicon and touch icon (`frontend/public/brand/`).

## API gaps (not yet implemented)

| # | Gap | Effect today | Smallest change that would close it |
|---|---|---|---|
| G1 | `/control-tower` KPIs use a fixed 30-day window | The Control Tower cannot filter KPIs by date | Optional `?days=7|30|90` parameter |
| G2 | Trip status changes, OptiRoute runs/dispatch and scenario decisions are not written to the audit log | The audit log and "Recent activity" miss key operational events (trip history is still on each trip) | `audit()` calls in `trips.service`, `optiroute.routes` and `scenarios.routes` |
| G3 | `POST /optiroute/runs` is synchronous | Fine for benchmarked sizes (≈1 s); very large plans would hold the request open | A job table and `GET /optiroute/runs/:id/status` |
| G4 | `PATCH /documents/:id` accepts JSON only | A stored scan cannot be replaced; users add the renewal as a new document | Accept `multipart/form-data` with an optional `file` on `PATCH` |

## Location search

### Goal

Let users find locations by address, landmark, business or warehouse name instead of typing coordinates, while keeping the Leaflet/OpenStreetMap maps and permanent coordinate storage.

### Provider comparison

Based on each provider's own terms and pricing pages as read in November 2026 (not legal advice; terms change).

| | LocationIQ | Geoapify | Mappls (MapmyIndia) |
|---|---|---|---|
| Storing results permanently | Terms: "You can store response data forever." Caching request/response pairs to avoid calls: 48 h on the free plan, for the life of a paid subscription | FAQ: results may be downloaded, cached and stored; no time limit stated | Terms forbid cache copies "to avoid paying fees"; data must be removed when the account ends |
| Results on a Leaflet/OSM map | Not restricted | Not restricted (Leaflet listed as supported) | **Prohibited** ("No Use With Non-Mappls Maps") |
| Commercial use | Free plan "limited commercial use" with a link back; paid plans list commercial use | Free plan allowed in production per FAQ; terms mention limitations | Paid plan required |
| Multi-tenant SaaS | Not addressed (non-sublicensable licence) | Not addressed (non-sublicensable) | Not addressed (non-sublicensable) |
| Attribution | OpenStreetMap; LocationIQ link on the free plan | OpenStreetMap; "Powered by Geoapify" on the free plan | "Powered by Mappls" logo |
| Autocomplete returns coordinates and address parts | Yes | Yes | No (address tokens restricted) |
| India coverage | OpenStreetMap + open datasets | OpenStreetMap + open datasets | Proprietary data (strongest), excluded by the map restriction |

**Decision:** LocationIQ as the primary provider, with a Geoapify adapter available as a fallback for provider failures (not enabled for zero-result searches). LocationIQ's terms explicitly allow storing response data, it bills in INR, and its autocomplete returns coordinates and address parts in one call. Operators should still confirm multi-tenant use, storage and attribution with the provider for their plan.

**Google Places was considered and not used:** its terms limit caching of coordinates to 30 days and prohibit showing Places results on a non-Google map, which conflicts with permanent coordinate storage and the OpenStreetMap maps.

### Design

- Server-side proxy (`/api/places/*`) with provider adapters behind one interface; the key never reaches the browser and provider URLs are never logged.
- `Location` gained optional `city`, `state`, `postalCode`, `country`, `placeProvider`, `providerPlaceId` and `coordsSource` (MANUAL / SEARCH / PIN_ADJUSTED) — migration `20261113120000_location_place_details`, additive only.
- Save rules: a search result saves its details with `SEARCH`; moving the pin afterwards gives `PIN_ADJUSTED`; pins or coordinates without search are `MANUAL`; editing without moving the pin leaves provenance untouched.

### Live evaluation (30 requests, November 2026)

- Good for landmarks, localities, industrial areas and PIN codes: the intended place came first for 14 of 22 test queries (Gateway of India, Mumbai airport, Bhiwandi, Andheri East, PIN 400059, Connaught Place, Koramangala, Electronic City, JNPT, Taloja MIDC, Sriperumbudur, Salt Lake Sector V, Hitech City, MG Road), mostly within 1 km.
- Weak for company/warehouse names and typos ("Amazon fulfillment center Bhiwandi" and "Andheri Eest" found nothing; some area searches ranked a single business first).
- Reverse geocoding returned street-level addresses within 0.1 km for 6 of 6 points.
- Average response time ≈ 0.4 s.

### Raw address fields (10 further requests) and resulting rules

| Observation | Rule implemented (`backend/src/modules/places/india.ts`) |
|---|---|
| Delhi results carry no `state` field (search and reverse) | Read the state from the full address (canonical list of 28 states and 8 union territories, with aliases such as "Orissa" and "NCT of Delhi"); fall back to city-UTs (Delhi, New Delhi, Chandigarh, Puducherry) |
| Ward, zone, taluka and tehsil names appear in `suburb`, `town`, `county` or `city_district` ("K/E Ward", "Mumbai Zone 3", "Khed") | Never use administrative units as the city |
| `city` can be a state name ("West Bengal") | Reject state names as cities; use the place's own name for settlement results |
| PIN-code results may have no city, only "Mumbai Suburban District" | Derive the city from a "… District" name as a last resort |
| Postcodes are sometimes missing or malformed | Accept only valid 6-digit Indian PINs |

### Search UX

- Editable city, state (select of the 36 states/UTs) and PIN; search results fill only empty or previously auto-filled fields; differences from typed or saved values are offered in a per-field preview.
- "Use pin's address" after moving the pin: one request per pin position, preview with distance to the matched address, applied only on confirmation, pin never moved.
- Fewer requests: per-dialog result cache, normalised queries, no request for extensions of a query that found nothing (except queries with digits), user-triggered "Broaden search".
- Saved company locations offered first; duplicate warnings (within 60 m, same name within 1 km, or same provider place) with "use existing" or "save anyway".

## Remaining limitations

See the README's [Known limitations](../../README.md#known-limitations).
