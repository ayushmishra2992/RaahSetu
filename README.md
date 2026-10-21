# RaahSetu 2.0

Fleet operations and dispatch platform with **constrained route optimisation (OptiRoute)**, transparent **GreenFleet** fuel/cost/CO₂ estimates, **what-if scenario re-planning** and an operational **Control Tower**.

- **Frontend:** Next.js 16.4 (App Router) · React 19 · TypeScript · Tailwind CSS 4
- **Backend:** Node.js · Express 5 · TypeScript · Zod validation · JWT (httpOnly cookie or Bearer)
- **Database:** PostgreSQL 15+ · Prisma 7 (driver adapter `@prisma/adapter-pg`)
- **Tests:** Vitest + Supertest (unit tests and integration tests against a real PostgreSQL test database)

> Estimates are estimates. Fuel/CO₂ figures come from configurable factors, vehicle positions are **simulated** (no GPS provider is connected), and QR verification checks RaahSetu records only — not government systems (VAHAN, GSTN e-invoice, e-way bill).

---

## Contents

1. [What is implemented](#what-is-implemented)
2. [Windows quick start (PowerShell)](#windows-quick-start-powershell)
3. [Demo logins (development only)](#demo-logins-development-only)
4. [Checks: type-check, lint, tests, build](#checks-type-check-lint-tests-build)
5. [Project structure](#project-structure)
6. [Scripts](#scripts)
7. [Architecture & security](#architecture--security)
8. [Limitations & integration boundaries](#limitations--integration-boundaries)
9. [Publish to GitHub](#publish-to-github)
10. [Troubleshooting](#troubleshooting)

Further docs: [`docs/API.md`](docs/API.md) (every endpoint) · [`docs/OPTIROUTE.md`](docs/OPTIROUTE.md) (optimisation model, algorithms, benchmarking) · [`docs/VERIFICATION.md`](docs/VERIFICATION.md) (what was and was not verified before delivery).

---

## What is implemented

| Module | What works end-to-end (API + UI) |
|---|---|
| **Auth & tenancy** | Company onboarding (creates company + admin), login/logout, `/me`, password change, JWT expiry, httpOnly cookie, rate-limited auth, deactivated users blocked immediately. Every query is scoped to the caller's company taken from the database — never from client input. |
| **Roles** | ADMIN, MANAGER, DISPATCHER, EMPLOYEE (read-only), DRIVER (own trips only). Central permission matrix (`backend/src/lib/permissions.ts`). |
| **Fleet** | Vehicles (capacity, fuel type, mileage, depot, status) and drivers (licence, expiry, shift limit, optional app login). |
| **Compliance** | RC / insurance / PUC / fitness / permit / licence records with expiry states and alerts; optional private file upload (PDF/PNG/JPEG/WEBP, size-limited, MIME + file-signature checked, tenant-checked download, never served statically). Expired blocking documents exclude a vehicle from planning and dispatch. |
| **Locations & road network** | Depots/warehouses/customers; road graph (nodes, one-way/two-way segments, speeds, open/closed); Dijkstra vs A* shortest-path tool. |
| **Orders** | Pickup → drop orders with weight, priority, ready time, delivery window, service time; cancel/edit while pending. |
| **Trips & dispatch** | Manual trip creation (stops sequenced & validated by OptiRoute), trips from an optimised plan, state machine PLANNED → DISPATCHED → IN_TRANSIT → COMPLETED / CANCELLED with transactional side effects, stop-level arrive / complete / skip, status timeline, driver self-service. |
| **OptiRoute** | Constrained multi-vehicle pickup-and-delivery routing (capacity, precedence, time windows, shift limits, eligibility, closed roads). Greedy baseline, local search, seeded simulated annealing. Independent validator, unserved-order reasons, objective breakdown, persisted run history, plan comparison, dispatch to trips. |
| **GreenFleet** | Per-vehicle fuel/energy, cost and CO₂ estimate for any job; estimated (trips) vs logged (fuel records) per vehicle; observed mileage from fills; all assumptions visible and editable in Settings. |
| **Scenarios** | Vehicle breakdown, driver unavailable, road closure, urgent order → re-optimise the base plan → before/after comparison → manager approval applies the change (and cancels not-yet-started base trips) or rejection leaves data untouched. |
| **Control Tower** | KPIs, alerts (expiring/expired documents & licences, late deliveries, trips not started, urgent unplanned orders, pending scenarios, closed roads), active trips with **simulated** positions, recent runs. |
| **Billing & QR** | GST invoices and delivery challans (draft → issued → paid / cancelled), printable view, QR code per invoice/challan/trip, public verification page. |
| **Audit** | Significant actions recorded per company (no secrets). |

---

## Windows quick start (PowerShell)

### 0. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | **22 LTS (22.12 or newer)** — 20.19+ and 24 also work | `node -v` |
| npm | 10+ (bundled with Node) | `npm -v` |
| PostgreSQL | **15, 16 or 17** (tested schema on 16) | `psql --version` |
| Git | any recent | `git --version` |

Install PostgreSQL from <https://www.postgresql.org/download/windows/> and remember the password you set for the `postgres` superuser. If `psql` is not recognised, use its full path, e.g. `& "C:\Program Files\PostgreSQL\16\bin\psql.exe"`.

### 1. Extract and open

```powershell
Expand-Archive -Path "$HOME\Downloads\raahsetu.zip" -DestinationPath "$HOME\Projects"
cd "$HOME\Projects\raahsetu"
code .
```

Open two terminals in VS Code (**Terminal → New Terminal**, then the split button) — both start in the project root.

### 2. Install dependencies

```powershell
npm run setup
```

This runs `npm install` in the root, `backend/` and `frontend/` using the committed `package-lock.json` files (the backend install also runs `prisma generate`). For a strictly reproducible install use `npm run setup:ci`.

On first use, the Prisma CLI downloads its native schema engine from `binaries.prisma.sh` (needed by `db:deploy` / `db:migrate`). Normal internet access is enough; on a locked-down network allow that host.

### 3. Create the databases

Choose your own password instead of `CHANGE_ME` (keep it out of Git).

```powershell
psql -U postgres -h localhost -c "CREATE ROLE raahsetu WITH LOGIN PASSWORD 'CHANGE_ME' CREATEDB;"
psql -U postgres -h localhost -c "CREATE DATABASE raahsetu OWNER raahsetu;"
psql -U postgres -h localhost -c "CREATE DATABASE raahsetu_test OWNER raahsetu;"
```

`raahsetu_test` is only used by the integration tests and is **wiped on every test run**.

### 4. Configure environment variables

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Edit `backend\.env`:

- `DATABASE_URL` → `postgresql://raahsetu:YOUR_PASSWORD@localhost:5432/raahsetu?schema=public`
- `TEST_DATABASE_URL` → `postgresql://raahsetu:YOUR_PASSWORD@localhost:5432/raahsetu_test?schema=public`
- `JWT_SECRET` → paste the random string printed above

`frontend\.env.local` only needs changing if the backend is not on `http://localhost:5000`. If your password contains special characters (`@`, `#`, `/`, `:`), URL-encode them in the connection string.

### 5. Apply migrations and (optionally) load demo data

```powershell
npm run db:deploy
npm run db:seed
```

`db:deploy` applies the committed migrations to a fresh (or the previous v1) database. `db:seed` creates **development-only** demo companies, users, fleet, a synthetic Mumbai–Pune–Nashik road network, pending orders for tomorrow and some history. It is idempotent — re-run it any time to refresh the demo delivery windows.

### 6. Start the backend and frontend

Terminal 1:

```powershell
npm run dev:backend
```

Terminal 2:

```powershell
npm run dev:frontend
```

(or run both in one terminal with `npm run dev`).

### 7. Open the app

| What | URL |
|---|---|
| Web app | <http://localhost:3000> |
| Login | <http://localhost:3000/login> |
| API health | <http://localhost:5000/api/health> (`"database": "ok"` when PostgreSQL is reachable) |
| API through the web app's proxy | <http://localhost:3000/api/health> |

### 8. Try the main workflow

1. Log in as `dispatcher@demo.raahsetu.local`.
2. **OptiRoute** → click *Tomorrow 08:00* → *Optimise routes*. Review routes, unserved reasons, excluded vehicles (one has an expired PUC), objective breakdown and assumptions.
3. *Create trips from plan* → **Trips** → open a trip → *Dispatch*.
4. Log in as `driver@demo.raahsetu.local` (or stay as dispatcher) → *Start trip* → mark stops *Picked up / Delivered* → *Complete trip*.
5. **Scenarios** → base plan = your run → *Vehicle breakdown* → compare → log in as `manager@…` to approve.
6. **Invoices & challans** → create an invoice for the completed trip → *Issue* → scan or open the QR link (works logged out).
7. **Control Tower** and **GreenFleet** show the results.

---

## Demo logins (development only)

Created by `npm run db:seed`. **Password for all: `Demo@1234`.** Never seed a production database (the seed refuses when `NODE_ENV=production`).

| Email | Role |
|---|---|
| `admin@demo.raahsetu.local` | ADMIN — everything incl. users & settings |
| `manager@demo.raahsetu.local` | MANAGER — fleet, documents, billing, scenario approval |
| `dispatcher@demo.raahsetu.local` | DISPATCHER — orders, trips, OptiRoute, scenarios |
| `viewer@demo.raahsetu.local` | EMPLOYEE — read-only |
| `driver@demo.raahsetu.local` | DRIVER — only Ravi Kumar's trips |
| `admin@other.raahsetu.local` | ADMIN of a second company — use it to see tenant isolation |

You can also register a brand-new company at <http://localhost:3000/register>.

---

## Checks: type-check, lint, tests, build

From the project root:

```powershell
npm run typecheck      # tsc --noEmit in backend and frontend
npm run lint           # ESLint (typescript-eslint / eslint-config-next)
npm test               # backend unit + integration tests, frontend unit tests
npm run build          # backend bundle (dist/server.js) + Next.js production build
npm run check          # all of the above in order
```

- Integration tests run against `TEST_DATABASE_URL`: the test setup drops its schema and applies every committed migration SQL file in order (no Prisma CLI needed). If it is not set they are **skipped** with a warning; unit tests still run.
- Backend only: `npm --prefix backend run test:unit` / `npm --prefix backend run test:integration`.
- Optimiser benchmark on synthetic instances: `npm run benchmark` (see `docs/OPTIROUTE.md`).

Production-style run after `npm run build`:

```powershell
npm start   # backend on :5000 (node dist/server.js) + frontend on :3000 (next start)
```

---

## Project structure

```
raahsetu/
├─ package.json              # root scripts (setup, dev, check, db:*), concurrently
├─ README.md · docs/API.md · docs/OPTIROUTE.md
├─ .gitignore · .gitattributes · .editorconfig · .nvmrc
├─ backend/
│  ├─ package.json · tsconfig.json · eslint.config.js · vitest.config.ts · prisma.config.ts
│  ├─ .env.example
│  ├─ prisma/
│  │  ├─ schema.prisma
│  │  ├─ seed.ts                       # development-only demo data
│  │  └─ migrations/                   # 20261005105336_init (v1) + 20261019120000_raahsetu_v2
│  ├─ src/
│  │  ├─ server.ts · app.ts
│  │  ├─ config/        env.ts (validated env) · prisma.ts
│  │  ├─ middleware/    auth.ts (JWT, permissions) · error.ts
│  │  ├─ lib/           errors, validation, permissions, audit, tokens, numbering
│  │  ├─ optimizer/     pure OptiRoute engine: types, graph (Dijkstra/A*), distance,
│  │  │                 costModel (GreenFleet factors), evaluate, solver, validate, rng, synthetic
│  │  ├─ modules/       auth, users, company, vehicles, drivers, documents, locations,
│  │  │                 roadNetwork, orders, trips, optiroute, scenarios, greenfleet,
│  │  │                 fuel, billing, verify (public QR), controlTower, audit
│  │  └─ scripts/benchmark.ts
│  └─ tests/  unit/ (optimizer, graph, domain) · integration/api.test.ts · globalSetup.ts
└─ frontend/
   ├─ package.json · next.config.ts (proxies /api → backend) · tsconfig.json · eslint.config.mjs
   ├─ .env.example
   └─ src/
      ├─ app/
      │  ├─ page.tsx (landing) · login/ · register/ · verify/[token]/ (public QR page)
      │  └─ (app)/  dashboard · vehicles · drivers · documents · locations · orders · trips
      │             optiroute (runs/[id], compare) · scenarios · greenfleet · billing
      │             users · audit · settings
      ├─ components/  AppShell, AuthProvider, RouteMap (schematic SVG), forms, ui
      └─ lib/         api client, useApi hook, formatters, types
```

---

## Scripts

| Where | Script | Purpose |
|---|---|---|
| root | `npm run setup` / `setup:ci` | install all three packages (`npm ci` variant uses lockfiles strictly) |
| root | `npm run dev` | backend + frontend together |
| root | `npm run check` | typecheck → lint → test → build |
| root | `npm run db:deploy` / `db:migrate` / `db:seed` / `db:reset` | Prisma migrate deploy / migrate dev (create new migrations) / seed / reset (**drops data**) |
| backend | `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:unit`, `test:integration`, `benchmark`, `db:generate`, `db:studio` | |
| frontend | `dev`, `build`, `start`, `typecheck`, `lint`, `test` | |

---

## Architecture & security

- **Same-origin API:** the browser only talks to Next.js; `next.config.ts` rewrites `/api/*` to Express, so the session cookie is first-party (`httpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`). API clients can use `Authorization: Bearer <token>` (returned by login).
- **Tenant isolation:** `companyId` always comes from the authenticated user loaded from the database. Reads/updates/deletes look records up with `{ id, companyId }`; references to other records (locations, vehicles, drivers, trips, edges) are verified to belong to the same company. Cross-company access returns 404. Covered by integration tests.
- **Validation & errors:** Zod schemas on every body/query; consistent JSON errors `{ error: { code, message, details } }`; Prisma unique/foreign-key errors mapped to 409.
- **Passwords:** bcrypt (cost 12), letter+number, ≥ 8 chars; emails normalised; login timing equalised.
- **Rate limits:** auth endpoints (configurable) and the public verification endpoint.
- **Uploads:** memory → validated (type allow-list + file signature + size) → private `UPLOAD_DIR/<companyId>/<random key>`; download only through an authenticated, tenant-checked endpoint with `nosniff`.
- **Transactions:** dispatch, trip transitions, stop updates, scenario approval, billing edits.
- **State machine:** invalid trip transitions are rejected (409); drivers can only start/complete their own trips.
- **Audit log:** significant actions with minimal metadata (never passwords, tokens or bodies).
- **Optimiser contract:** `backend/src/optimizer` is pure TypeScript with typed inputs/outputs, so a different engine (e.g. a future ApexCUDA adapter) can be swapped in behind `solve(instance)`.

---

## Limitations & integration boundaries

| Area | Status |
|---|---|
| Live GPS / telemetry | **Simulator** (`backend/src/modules/trips/telemetry.ts`) interpolates along the planned schedule; always labelled "simulated". Plug a provider in there. |
| Maps / traffic | No map tiles or traffic API (none configured). Maps are schematic SVG; distances come from your road network or a labelled straight-line × 1.3 estimate. |
| Road network data | Demo network is **synthetic** (straight-line × 1.25). Enter surveyed distances or import a real graph for operations. |
| Emission factors & fuel prices | Configurable defaults (diesel 2.68 kg/L, petrol 2.31 kg/L, CNG 2.75 kg/kg, grid 0.71 kg/kWh; INR placeholder prices). Verify before formal reporting. |
| ML fuel prediction | Not included — no representative data to train/validate against a baseline. |
| GST / e-invoice / e-way bill / VAHAN / FASTag | Not integrated. Invoices apply a single GST % on the subtotal; QR verification is RaahSetu-only. |
| ApexCUDA / GPU, QPSO | Not included. Simulated annealing is a classical metaheuristic; no quantum or GPU speed-ups are claimed. |
| Email / SMS / password reset | Not included (admins set initial passwords; users change them in Settings). |
| File storage | Local private directory. For cloud deployment, swap `modules/documents/storage.ts` for S3/GCS with signed URLs. |

---

## Publish to GitHub

Create an **empty** repository on GitHub first (no README/licence/.gitignore), then in PowerShell from the project root:

```powershell
cd "$HOME\Projects\raahsetu"
git init
git branch -M main
git add .
git status
```

**Before committing, inspect the staged list.** It must **not** contain `node_modules/`, `.next/`, `dist/`, `backend/.env`, `frontend/.env.local`, `backend/uploads/` or any key/token. Only `.env.example` files are allowed. If something sensitive is staged: `git rm --cached <path>` and add it to `.gitignore`. Also check the lockfiles are staged (`backend/package-lock.json`, `frontend/package-lock.json`, `package-lock.json`).

```powershell
git diff --cached --name-only | Select-String -Pattern "\.env$|\.env\.local|node_modules|\.next|uploads"
git commit -m "RaahSetu 2.0: fleet ops, OptiRoute, GreenFleet, scenarios, control tower"
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

The `Select-String` line should print nothing. If your old repository (with `backend/.env` or `node_modules` in its history) was ever pushed, rotate that database password — deleting a file later does not remove it from Git history.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid backend environment configuration … JWT_SECRET` | Set a ≥ 32-character `JWT_SECRET` in `backend\.env`. |
| `/api/health` shows `"database": "unreachable"` / `P1001` | PostgreSQL service not running or wrong `DATABASE_URL` (check password, port 5432, URL-encoding). |
| `Cannot find module '../generated/prisma/client'` | Run `npm --prefix backend run db:generate`. |
| Login page says it cannot reach the API | Backend is not running on port 5000, or `BACKEND_URL` in `frontend\.env.local` is wrong (restart `npm run dev:frontend` after changing it). |
| OptiRoute: "No eligible vehicle…" | Vehicles need a depot, AVAILABLE status, unexpired RC/insurance/PUC/fitness/permit, and an AVAILABLE driver with a valid licence. The error lists each exclusion. |
| Demo orders all unserved | Their delivery windows are tomorrow — choose *Tomorrow 08:00* as plan start, or re-run `npm run db:seed`. |
| Port already in use | Change `PORT` in `backend\.env` (and `BACKEND_URL` in the frontend) or stop the other process. |
| `psql` not recognised | Use `& "C:\Program Files\PostgreSQL\<version>\bin\psql.exe" …` or add that folder to PATH. |
