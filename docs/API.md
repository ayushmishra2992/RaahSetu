# RaahSetu — API reference

Base URL (development): `http://localhost:5000/api` — or `http://localhost:3000/api` through the Next.js proxy.

**Auth:** `POST /auth/login` sets an httpOnly `rs_token` cookie and also returns `token`; send it as `Authorization: Bearer <token>` from non-browser clients.
**Errors:** `{ "error": { "code": "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "UNPROCESSABLE" | "RATE_LIMITED" | "INTERNAL", "message": "...", "details": [...] } }`. Location-search endpoints add `PLACES_DISABLED`, `PLACES_RATE_LIMITED`, `PLACES_UNAVAILABLE`, `PLACES_TIMEOUT` and `PLACES_REVERSE_UNSUPPORTED`.
**Rate limits:** `/auth/*` (`AUTH_RATE_LIMIT_PER_15_MIN` per IP), `/public/verify/*` (60/min per IP), `/places/autocomplete` + `/places/reverse` (shared `PLACES_RATE_LIMIT_PER_MIN` per company). Exceeding a limit returns `429`.
**Tenancy:** all authenticated routes are scoped to the caller's company. Records of other companies return `404`.
**Dates:** ISO-8601 strings (UTC). **IDs:** positive integers.

Permission names below map to roles in `backend/src/lib/permissions.ts`:

| Permission | Roles |
|---|---|
| `company:manage`, `users:manage` | ADMIN |
| `fleet:write`, `documents:write`, `billing:write`, `scenarios:approve`, `audit:read` | ADMIN, MANAGER |
| `orders:write`, `trips:write`, `optimize:run`, `locations:write`, `fuel:write` | ADMIN, MANAGER, DISPATCHER |
| `trips:progress` | ADMIN, MANAGER, DISPATCHER, DRIVER (own trips) |
| `*:read`, `dashboard:read` | ADMIN, MANAGER, DISPATCHER, EMPLOYEE (`trips:read`/`locations:read` also DRIVER) |

## Public

| Method & path | Description |
|---|---|
| `GET /health` | Service + database status (`503` if DB unreachable) |
| `GET /public/verify/:token` | QR verification of an invoice, challan or trip. Minimal data, rate-limited. |

## Auth — `/auth`

| Method & path | Body | Notes |
|---|---|---|
| `POST /auth/register-company` | `{ companyName, gstNumber?, city?, state?, adminName, email, password }` | Creates company + ADMIN, logs in. Password ≥ 8 chars with a letter and a digit. |
| `POST /auth/login` | `{ email, password }` | Returns `{ token, user, company, permissions }` and sets cookie. |
| `POST /auth/logout` | – | Clears cookie. |
| `GET /auth/me` | – | Current user, company (with settings) and permission list. |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` | |

## Company & users

| Method & path | Permission | Body / query |
|---|---|---|
| `GET /company` | any | Company profile + validated settings |
| `PATCH /company` | company:manage | `{ name?, gstNumber?, address?, city?, state?, phone?, settings? }` — settings: `fuelPricePerUnit`, `emissionKgPerUnit` (per fuel), `loadPenaltyAtFullLoad`, `driverCostPerHour`, `defaultWeights`, `documentExpiryAlertDays` |
| `GET /users` | users:manage | |
| `POST /users` | users:manage | `{ name, email, password, role }` |
| `PATCH /users/:id` | users:manage | `{ name?, role?, isActive? }` — cannot demote/deactivate yourself or the last admin |

## Fleet

| Method & path | Permission | Body / query |
|---|---|---|
| `GET /vehicles` | fleet:read | `?status=&search=` |
| `GET /vehicles/:id` | fleet:read | Includes documents, recent trips, fuel records |
| `POST /vehicles` | fleet:write | `{ registrationNumber, type, make?, model?, year?, capacityKg, fuelType, mileageKmPerUnit, avgSpeedKmph?, odometerKm?, depotLocationId? }` |
| `PATCH /vehicles/:id` | fleet:write | Any subset; `status` ∈ AVAILABLE/MAINTENANCE/INACTIVE (ON_TRIP is managed by dispatch) |
| `DELETE /vehicles/:id` | fleet:write | 409 if it has trip history |
| `GET /drivers` · `GET /drivers/:id` | fleet:read | `?status=` |
| `POST /drivers` · `PATCH /drivers/:id` · `DELETE /drivers/:id` | fleet:write | `{ name, phone, licenseNumber, licenseExpiry, maxShiftHours?, userId?, status? }` (`userId` must be a DRIVER user of your company) |

## Compliance documents — `/documents`

| Method & path | Permission | Notes |
|---|---|---|
| `GET /documents` | documents:read | `?type=&vehicleId=&driverId=&expiringWithinDays=` → each has `expiryState` (EXPIRED / EXPIRING_SOON / VALID / NO_EXPIRY) and `hasFile` |
| `POST /documents` | documents:write | `multipart/form-data` or JSON: `type, documentNumber, issuedOn?, expiresOn?, notes?, vehicleId | driverId, file?` (PDF/PNG/JPEG/WEBP ≤ `MAX_UPLOAD_MB`) |
| `PATCH /documents/:id` · `DELETE /documents/:id` | documents:write | |
| `GET /documents/:id/file` | documents:read | Authenticated download |

## Locations & road network

| Method & path | Permission | Body / query |
|---|---|---|
| `GET /locations` | locations:read | |
| `POST /locations` · `PATCH /locations/:id` | locations:write | `{ name, type, lat, lng, address?, roadNodeId?, city?, state?, postalCode?, country?, placeProvider?, providerPlaceId?, coordsSource? }` — `type` ∈ DEPOT/WAREHOUSE/CUSTOMER/OTHER; `state` is stored under its canonical Indian state/UT name ("Orissa" → "Odisha", "NCT of Delhi" → "Delhi"); `placeProvider` ∈ locationiq/geoapify; `coordsSource` ∈ MANUAL/SEARCH/PIN_ADJUSTED (default MANUAL); blank text is stored as `null` |
| `DELETE /locations/:id` | locations:write | 409 if used by orders or trips |
| `GET /road-network` | locations:read | `{ nodes, edges }` |
| `POST /road-network/nodes` · `DELETE /road-network/nodes/:id` | locations:write | `{ name, lat, lng }` |
| `POST /road-network/edges` | locations:write | `{ fromNodeId, toNodeId, distanceKm?, speedKmph?, bidirectional?, name? }` (distance defaults to straight line × 1.25) |
| `PATCH /road-network/edges/:id` · `DELETE …` | locations:write | `{ isClosed?, speedKmph?, distanceKm?, name? }` |
| `GET /road-network/path?from=&to=` | locations:read | Shortest path (A*) plus Dijkstra comparison |

## Location search — `/places`

Server-side proxy to the configured provider (`PLACES_PROVIDER`); the API key never reaches the browser. Responses carry `Cache-Control: no-store`.

| Method & path | Permission | Query / response |
|---|---|---|
| `GET /places/status` | locations:read | `{ enabled, provider, fallback, reverse, attribution[], minQueryLength, reason? }` — `reason` is `not_configured` or `missing_key` when disabled |
| `GET /places/autocomplete?q=` | locations:write | `q` 3–120 chars → `{ provider, attribution[], results[] }`; each result: `{ providerPlaceId, name, address, city, state, postalCode, country, lat, lng }` (Indian results: canonical state/UT, settlement as city, 6-digit PIN or `null`). `503 PLACES_DISABLED` when no provider is configured |
| `GET /places/reverse?lat=&lng=` | locations:write | `{ provider, attribution[], place \| null, distanceM }` — nearest address to the point; `distanceM` is the distance from the requested point to the matched address. `501` if the provider has no reverse lookup |

`provider` and `attribution` always name whichever provider actually answered (the fallback, if configured and the primary failed).

## Orders — `/orders`

| Method & path | Permission | Body / query |
|---|---|---|
| `GET /orders` · `GET /orders/:id` | orders:read | `?status=&priority=` |
| `POST /orders` | orders:write | `{ customerName, pickupLocationId, dropLocationId, weightKg, priority?, readyAt?, windowStart?, windowEnd?, serviceMinutes?, customerPhone?, notes?, declaredValue?, orderNumber? }` |
| `PATCH /orders/:id` | orders:write | PENDING orders only |
| `POST /orders/:id/cancel` · `DELETE /orders/:id` | orders:write | PENDING / not on a trip |

## Trips — `/trips`

| Method & path | Permission | Body |
|---|---|---|
| `GET /trips` · `GET /trips/:id` | trips:read | Drivers only see their own trips. Detail includes stops, events, billing docs and `simulatedPosition` when in transit. |
| `POST /trips` | trips:write | `{ vehicleId, driverId, orderIds[], plannedStart?, notes? }` → stops sequenced by OptiRoute; `422` with reasons if infeasible |
| `POST /trips/:id/status` | trips:progress | `{ status, note? }` — PLANNED→DISPATCHED/CANCELLED, DISPATCHED→IN_TRANSIT/CANCELLED, IN_TRANSIT→COMPLETED/CANCELLED |
| `POST /trips/:id/stops/:stopId` | trips:progress | `{ action: "ARRIVE" | "COMPLETE" | "SKIP" }` (trip must be IN_TRANSIT) |
| `GET /trips/:id/qr` | trips:read | `{ url, dataUrl }` |

## OptiRoute — `/optiroute`

| Method & path | Permission | Body |
|---|---|---|
| `GET /optiroute/meta` | optimize:read | Algorithms, default weights, objective, hard constraints |
| `POST /optiroute/runs` | optimize:run | `{ name?, algorithm?, seed?, orderIds?, vehicleIds?, assignments?[{vehicleId,driverId}], weights?{time,distance,cost,emissions,lateness,risk}, hardTimeWindows?, returnToDepot?, maxIterations?, planStart?, useRoadNetwork?, unservedPenalty? }` — defaults: all PENDING orders, all AVAILABLE vehicles |
| `GET /optiroute/runs` · `GET /optiroute/runs/:id` | optimize:read | Run summary / full result (`routes`, `unserved` with reasons, `exclusions`, `objective` breakdown, `violations`, `assumptions`, `convergence`) |
| `POST /optiroute/runs/:id/dispatch` | trips:write | Creates PLANNED trips; 409 if already dispatched, infeasible or stale |

## Scenarios — `/scenarios`

| Method & path | Permission | Body |
|---|---|---|
| `GET /scenarios` · `GET /scenarios/:id` | optimize:read | |
| `POST /scenarios` | optimize:run | `{ type, name, baseRunId, params }` with `params` = `{ vehicleId }` (VEHICLE_BREAKDOWN), `{ driverId }` (DRIVER_UNAVAILABLE), `{ edgeIds[] }` (ROAD_CLOSURE), `{ customerName, pickupLocationId, dropLocationId, weightKg, windowStart?, windowEnd?, serviceMinutes? }` (URGENT_ORDER) |
| `POST /scenarios/:id/approve` · `POST /scenarios/:id/reject` | scenarios:approve | `{ note? }` |

## GreenFleet & fuel

| Method & path | Permission | Body / query |
|---|---|---|
| `POST /greenfleet/estimate` | greenfleet:read | `{ distanceKm, loadKg?, durationMin?, vehicleIds? }` → rows sorted by CO₂ + assumptions |
| `GET /greenfleet/summary` | greenfleet:read | `?days=30` estimated vs logged per vehicle |
| `GET /greenfleet/vehicle/:id` | greenfleet:read | Observed mileage + fills |
| `GET /fuel-records` | greenfleet:read | `?vehicleId=` |
| `POST /fuel-records` · `DELETE /fuel-records/:id` | fuel:write | `{ vehicleId, filledAt, quantity, totalCost, odometerKm, notes? }` |

## Billing — `/billing`

| Method & path | Permission | Body |
|---|---|---|
| `GET /billing` · `GET /billing/:id` | billing:read | `?kind=&status=` |
| `POST /billing` | billing:write | `{ kind: INVOICE | DELIVERY_CHALLAN, tripId?, customerName, customerGstin?, customerAddress?, taxRatePercent?, dueDate?, notes?, items[{ description, quantity, unit?, rate }] }` |
| `PUT /billing/:id` | billing:write | Same body without `kind`; DRAFT only |
| `POST /billing/:id/issue` · `/mark-paid` · `/cancel` | billing:write | DRAFT→ISSUED→PAID; DRAFT/ISSUED→CANCELLED |
| `GET /billing/:id/qr` | billing:read | `{ url, dataUrl }` |

## Control Tower & audit

| Method & path | Permission | Description |
|---|---|---|
| `GET /control-tower` | dashboard:read | Counts, KPIs, alerts, active trips with simulated positions, recent runs |
| `GET /audit` | audit:read | `?entityType=&entityId=&limit=` |
