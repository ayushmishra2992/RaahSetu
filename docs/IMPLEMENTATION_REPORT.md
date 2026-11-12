# RaahSetu 2.0 — Implementation report (Phases 3–8)

Living document. Updated at the end of each phase.

## Starting state (audited 2026-11-12)

- Branch `phase-2-design-system`, on top of `7b96f11`. Phase 2 (design system, shell, confirmations, Playwright) is **uncommitted** and is being built on in place — nothing stashed, reset or reverted.
- Frontend: Next.js 16 App Router, every page a client component using `useApi()` against same-origin `/api/*` (proxied to Express).
- Backend: Express 5 + Prisma 7. Every route is company-scoped and permission-checked (`backend/src/lib/permissions.ts`).
- Tests: Vitest unit tests (frontend + backend), backend integration tests against `raahsetu_test`, Playwright smoke tests with in-browser API mocks (no database).

## Boundaries for this work

- **Frontend-only by default.** No schema, migration, seed or database change. Where a feature needs data the API does not expose, the gap is documented below with the smallest API change that would close it; it is **not** implemented without approval.
- Every number on screen comes from an API response or is arithmetic over one (e.g. a sum of listed invoice totals). Estimates are labelled as estimates; simulated positions as simulated.
- No commits, pushes or merges without approval.

## Reusable building blocks

| Need | Existing piece |
|---|---|
| KPIs, counts, alerts, live trips, recent runs | `GET /control-tower` |
| Recent activity | `GET /audit?limit=` (ADMIN, MANAGER only) |
| Upcoming expiries | `GET /documents?expiringWithinDays=` (returns `expiryState`) |
| Fuel and emissions | `GET /greenfleet/summary?days=` (estimated vs logged) |
| Order detail and its trips | `GET /orders/:id` (includes `tripStops.trip`) |
| Order editing | `PATCH /orders/:id` (PENDING only) |
| Trip audit trail | trip `events` + `GET /audit?entityType=Trip&entityId=` |
| Optimisation | `GET /optiroute/meta`, `POST /optiroute/runs` (synchronous), run `convergence`, `objective`, `violations`, `exclusions`, `unserved` |
| UI | `@/components/ds` (Phase 2), `RouteMap` (Leaflet + schematic fallback) |

## Plan and acceptance criteria

### Phase 3 — Control Tower
- KPI row from `kpis` (utilisation, on-time, trips, planned km, est. cost, est. CO₂) with the API's own definitions as hints.
- Fleet availability bars (vehicles and drivers by status), order pipeline and trip pipeline from `counts`.
- Alerts with severity filter and counts; each links to the record.
- Live map of dispatched / in-transit trips (simulated positions, clearly labelled) with a status filter and a trip list.
- Upcoming expiries (`/documents?expiringWithinDays=<alert window>`), pending orders whose delivery window has passed (computed from `/orders?status=PENDING`), recent activity (`/audit`, only when permitted), fuel and emissions (`/greenfleet/summary`, period filter 7/30/90), OptiRoute run summaries.
- Permission-aware quick actions.
- **Accept when:** no number on the page lacks an API source; every panel has loading, empty and error states; sections a role cannot read are hidden rather than erroring.

### Phase 4 — OptiRoute
- Workspace with a step layout: orders → vehicles → constraints and objective → run; pre-flight checks (load vs capacity, vehicles without a depot, nothing selected).
- Searchable, filterable order and vehicle selection with select all / none.
- Run errors shown with retry; run history as a sortable table with compare selection.
- Run detail in tabs: overview (feasibility, served, totals, objective breakdown, convergence chart), routes (map + per-vehicle utilisation and stop tables), unserved and exclusions with reasons, assumptions.
- Copy states that results are the best plan the chosen heuristic found, not a proven optimum.
- Compare view colours deltas by whether the change is better or worse for that metric.
- **Accept when:** the request body sent to `POST /optiroute/runs` is unchanged in shape; dispatch still uses the existing endpoint and confirmation.

### Phase 5 — Orders, trips and dispatch
- Orders: status tabs with counts, search, priority filter, detail drawer (linked trips), edit for PENDING orders, cancel with confirmation, client-side validation mirroring the backend rules (pickup ≠ drop, window end after start, positive weight).
- Trips: status tabs, search; detail with a lifecycle stepper, stop timeline (cards on phones), audit trail, QR dialog, linked billing documents, clear conflict handling (409/422 messages shown, data reloaded).
- Manual dispatch: capacity meter, driver and vehicle pickers with availability, infeasibility reasons listed.
- **Accept when:** existing status transitions and endpoints are untouched; Playwright covers edit, filter and the conflict path.

### Phase 6 — Fleet and compliance
- Vehicles and drivers: summary counts, searchable sortable tables, mobile-friendly; detail pages with compliance state computed from expiry dates and the company alert window.
- Driver form: pick the linked DRIVER user from a list when the viewer can list users (ADMIN); otherwise the existing id field.
- Compliance: counts by expiry state, state tabs, owner filter, mobile cards, honest copy (dates you entered, no government verification).
- Locations and roads: tabs for locations, road network and shortest path.

### Phase 7 — Business and administration
- Billing: list with totals per status (sum of listed documents), filters; GST shown as the single rate the backend applies (no CGST/SGST/IGST split).
- GreenFleet: estimated vs logged clearly separated; chart of estimated vs logged CO₂ per vehicle.
- Scenarios: list and detail with direction-aware deltas.
- Users: searchable table and role reference. Audit: readable action names and structured details instead of raw JSON. Settings: sectioned.
- Error page shows a generic message (not raw error text); login hides the seed hint unless running in development.

### Phase 8 — Release readiness
- Unit, Playwright, typecheck, lint and production build; responsive checks at 390, 768, 1024 and 1440 px; bundle size review; final screenshots; this report finalised.

## API gaps (proposed, not implemented)

| # | Gap | Effect today | Smallest change that would close it |
|---|---|---|---|
| G1 | `/control-tower` KPIs use a fixed 30-day window | Control Tower can't filter KPIs by date; the page says "last 30 days" instead | Optional `?days=7|30|90` query on `/control-tower` (same queries, parameterised `since`) |
| G2 | Trip status changes, OptiRoute run creation and dispatch, and scenario create/approve/reject are not written to the audit log | Audit log and "Recent activity" miss the most important operational events; trip history is still visible from trip `events` | Add `audit()` calls in `trips.service` (status, stop actions), `optiroute.routes` (run, dispatch) and `scenarios.routes` (create, approve, reject) |
| G3 | `POST /optiroute/runs` is synchronous | Fine for today's instance sizes (≤ ~1 s in the benchmark); very large plans would hold the request open | Only if needed: job table + `GET /optiroute/runs/:id/status` |

## Progress log

### Phase 3 — Control Tower ✅
- Rebuilt `dashboard/page.tsx`: KPI row (each with its API definition), permission-aware quick actions, critical-alert banner, live operations map with status tabs and per-trip progress, alerts with severity tabs, fleet/driver/order/trip status bars, pending orders past their delivery window, compliance expiries in the company alert window, recent activity (audit, ADMIN/MANAGER only), fuel & emissions with a 7/30/90-day period (estimated vs logged kept separate), recent OptiRoute runs.
- New `ds/Charts.tsx` (StackedBar, Meter, BarList, PairedBars, LineChart): no chart dependency, colour always paired with a label, text summary for screen readers.
- New `lib/audit.ts` (readable audit actions, record links, metadata pairs) with unit tests.
- `Card` sections are now labelled by their heading (named regions for assistive tech).
- Fix: grids without a base column could overflow on phones; all now start from `grid-cols-1`.
- Tests: `e2e/control-tower.spec.ts` (figures, alert filter, quick actions, trip filter, employee restrictions, empty and error states).
- Limitations: G1 (fixed 30-day KPI window), G2 (activity feed misses trip/run/scenario events). Positions remain simulated and are labelled as such.

### Phase 4 — OptiRoute ✅
- Workspace with "New plan" / "Run history" tabs. Planner steps: searchable, priority-filtered order selection with select/clear shown; vehicle selection flagging vehicles without a depot; algorithm cards, plan settings, constraint switches, objective weights with "company defaults".
- Live plan summary: load vs combined capacity, pre-flight checks (`preflight.ts`, unit-tested) that restate facts from the selection (missing depot, over-heavy orders, windows closing before plan start, urgent orders). Errors show the server's reasons with Retry. Sticky run bar on small screens.
- Run detail: totals, tabs for overview (map, feasibility, per-vehicle utilisation, objective breakdown, convergence chart), routes, unserved & exclusions, assumptions. Copy states the plan is the best the heuristic found, not a proven optimum. "Create trips" explains why it's unavailable and surfaces 409 conflicts.
- Compare: pick runs in-page; deltas judged per metric (`compare.ts`, unit-tested) so more served orders reads as better; warning when runs planned different orders.
- Request body to `POST /optiroute/runs` and the dispatch call are unchanged.
- Tests: `e2e/optiroute.spec.ts` (request body, empty selection, solver error + retry, employee read-only, results tabs, comparison verdicts, history compare).
