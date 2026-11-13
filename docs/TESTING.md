# Testing

RaahSetu has four layers of automated checks. All commands below exist in the `package.json` files.

| Layer | Tool | Where | Needs |
|---|---|---|---|
| Static checks | TypeScript (`tsc --noEmit`), ESLint 9 | backend + frontend | nothing |
| Backend unit tests | Vitest | `backend/tests/unit/` | nothing (no database) |
| Backend integration tests | Vitest + Supertest against real PostgreSQL | `backend/tests/integration/` | `TEST_DATABASE_URL` |
| Frontend unit tests | Vitest | `frontend/src/**/*.test.ts` | nothing |
| Browser tests | Playwright (Chromium / Edge) | `frontend/e2e/` | a running frontend; the API is mocked in the browser |

## Running

```bash
# Everything except the browser tests
npm run typecheck
npm run lint
npm test                                   # backend unit + integration, then frontend unit
npm run check                              # typecheck → lint → test → build

# Individually
npm --prefix backend run test:unit
npm --prefix backend run test:integration
npm --prefix frontend test
```

### Integration tests and the test database

- Set `TEST_DATABASE_URL` in `backend/.env` to a **separate, disposable** database (see [INSTALLATION.md](INSTALLATION.md#4-create-the-databases)).
- Before the run, `backend/tests/globalSetup.ts` drops and recreates that database's `public` schema and applies every committed migration's SQL in order — so the tests always start from the same schema that `prisma migrate deploy` produces.
- Safety: it refuses to run when `TEST_DATABASE_URL` equals `DATABASE_URL` or names a database called `raahsetu`. Without `TEST_DATABASE_URL` the integration suite is **skipped** (unit tests still run).
- `backend/vitest.config.ts` forces `PLACES_PROVIDER=none` and a test-only `JWT_SECRET`, so tests never call a real location-search provider or use your real secret.

### Browser tests (Playwright)

```bash
cd frontend
npx playwright install chromium    # once; or use an installed browser via PLAYWRIGHT_CHANNEL=msedge|chrome
npm run test:e2e                   # starts `next dev` on :3000 if nothing is running there
```

- Every `/api/*` request is answered inside the browser by fixtures (`frontend/e2e/fixtures/`), so no backend or database is needed. A test fails if the page calls an endpoint without a fixture or throws an uncaught error. Map tiles are served from a local placeholder (automated traffic to OpenStreetMap's tile servers is not allowed).
- **Release run against a production build** (enables the bundle-size budget and "no developer hints" checks):

  ```bash
  cd frontend
  npx next build
  npx next start -p 3100            # in a second terminal
  E2E_BASE_URL=http://localhost:3100 E2E_PRODUCTION=1 npx playwright test
  ```

- Review screenshots (skipped unless requested): `SCREENSHOT_DIR=<folder> npx playwright test screenshots` (`SCREENSHOT_PAGES`, `SCREENSHOT_WIDTHS` and `REAL_TILES=1` are optional).
- Because the API is mocked, browser tests verify the UI's requests and behaviour; backend behaviour is verified by the backend suites.

### Optimiser benchmark

```bash
npm run benchmark                 # synthetic instances, fixed seeds; see docs/OPTIROUTE.md
```

## What is covered

**Backend unit (6 files):** OptiRoute solver and validator (`optimizer.test.ts`), road graph Dijkstra/A* (`graph.test.ts`), domain rules (`domain.test.ts`), document numbering (`numbering.test.ts`), location-search adapters, fallback, rate limits and reverse geocoding with a fake `fetch` (`places.test.ts`), Indian state/UT, city, ward and PIN rules using recorded LocationIQ responses (`india.test.ts`).

**Backend integration (29 tests, real PostgreSQL):** authentication and sessions; role matrix; **tenant isolation** (cross-company reads, writes, deletes and file downloads return 404; client-supplied `companyId` ignored); uploads with signature checks; locations including search details and canonical states; input validation; OptiRoute → trips → full trip lifecycle with driver restrictions; exclusion of vehicles with expired documents; breakdown scenario → compare → approve; invoices and the public QR page (draft invoices are not verifiable); GreenFleet estimates and the Control Tower snapshot; concurrency (dispatch, order assignment, trip transitions, stop updates and scenario approval each apply only once under parallel requests); location-search endpoints when not configured.

**Frontend unit (12 files):** formatters, billing totals (mirrors the backend), validation rules, safe login redirects, navigation permissions, audit descriptions, map helpers, OptiRoute run comparison and pre-flight checks, order validation, location-search helpers (cache, dead-end detection, broaden search, duplicate detection) and Indian states/PIN codes.

**Browser (13 spec files):** authentication and redirects (including open-redirect attempts), app shell and navigation, a 5-role × 15-page access matrix, Control Tower, OptiRoute planning and comparison, orders/trips/dispatch, fleet and compliance, billing, GreenFleet, scenarios, users, audit, settings, location search (autocomplete, keyboard use, pin dragging, reverse geocoding preview, caching, broaden search, saved locations, duplicate warnings), accessibility basics (one `h1`, accessible names, `lang`, no console errors), layout without horizontal scrolling at 390/768/1024/1440 px, security headers, and a JavaScript size budget.

## Latest verification — 13 Nov 2026

Executed during the public-release preparation.

### From a clean copy of the publishable files

Only files that `git add` would include were copied to an empty folder (no `.env` files, no `node_modules`, no build output), then:

| Step | Command | Result |
|---|---|---|
| Install from lockfiles | `npm run setup:ci` | ✅ exit 0 (Node 24.21, npm 11.19) |
| Type-check | `npm run typecheck` | ✅ 0 errors |
| Lint | `npm run lint` | ✅ 0 problems |
| Backend unit tests | `npm --prefix backend run test:unit` | ✅ 102 / 102 |
| Frontend unit tests | `npm --prefix frontend test` | ✅ 82 / 82 |
| Production builds | `npm run build` | ✅ `backend/dist/server.js` + Next.js build |
| Migrations on an **empty** PostgreSQL 18 database | `npx prisma migrate deploy` then `npx prisma migrate status` | ✅ 3 migrations applied; "Database schema is up to date" |
| Backend integration tests | `npm --prefix backend run test:integration` (with `TEST_DATABASE_URL`) | ✅ 29 / 29 |
| Production dependency audit | `npm audit --omit=dev` (backend, frontend) | ✅ 0 vulnerabilities |

### Browser tests

| Run | Result |
|---|---|
| Playwright against the production build (`E2E_PRODUCTION=1`, Edge) | ✅ 217 passed, 85 skipped (84 opt-in screenshot captures and 1 dev-only component catalogue test) |

### Not verified in this pass

- **Docker Compose** (`docker compose up --build`) — Docker was not available on the verification machine.
- **GitHub Actions CI** — runs once the repository is pushed.
- A manual walkthrough with the demo seed loaded (the seed was not run on the verification databases).

Earlier verification records are kept in [VERIFICATION.md](VERIFICATION.md).
