> **Historical record.** The current verification results (13 Nov 2026) and how to run every suite are in [TESTING.md](TESTING.md). The record below is from an earlier version of the project and its counts are out of date.

# Verification status

Verified on 21–22 Oct 2026 in a Linux sandbox (Node 22.22, npm 10.9, PostgreSQL 16.15) from a **fresh `git clone`** of this repository, installing strictly from the committed lockfiles with `npm run setup:ci`, against newly created empty databases.

| Check | Command | Result |
|---|---|---|
| Install from lockfiles (root, backend, frontend) | `npm run setup:ci` | ✅ passed |
| Production dependency audit | `npm audit --omit=dev` (backend, frontend) | ✅ 0 vulnerabilities |
| Prisma schema validation | `npx prisma validate` | ✅ valid |
| Prisma client generation | `prisma generate` (runs on install and build) | ✅ passed |
| Migrations on a fresh PostgreSQL 16 database | migration SQL applied in order (see note) | ✅ passed |
| Demo seed, run twice (idempotent) | `npm run db:seed` | ✅ passed |
| Type-check backend + frontend | `npm run typecheck` | ✅ 0 errors |
| Lint backend + frontend | `npm run lint` | ✅ 0 errors, 0 warnings |
| Backend unit tests | `npm --prefix backend run test:unit` | ✅ 25/25 |
| Backend integration tests on real PostgreSQL (auth, roles, cross-company isolation, uploads, OptiRoute → trips → lifecycle, invoices + public QR, scenarios, GreenFleet, Control Tower, audit) | `npm --prefix backend run test:integration` | ✅ 19/19 |
| Frontend unit tests | `npm --prefix frontend test` | ✅ 5/5 |
| Backend production bundle | `npm --prefix backend run build` | ✅ passed |
| Next.js production build (27 routes) | `npm --prefix frontend run build` | ✅ passed |
| Production servers start; `/api/health` reports DB ok directly and through the Next.js proxy | `node dist/server.js` + `next start` | ✅ passed |
| Browser end-to-end run (Playwright/Chromium against production servers, 23 steps) | sandbox script | ✅ 23/23 |
| CI-equivalent run: fresh clone, no `backend/.env`, only `TEST_DATABASE_URL` set (as in `.github/workflows/ci.yml`) | `npm run setup:ci && npm run check` + benchmark smoke run | ✅ passed |
| One-click demo login (`NEXT_PUBLIC_DEMO_MODE=true`) | browser | ✅ passed |
| Next.js standalone output used by `frontend/Dockerfile`, serving pages and proxying the API | `NEXT_OUTPUT=standalone next build` + `node server.js` | ✅ passed |

The browser run covered: signed-out redirect; login as dispatcher; all 12 main pages render without errors; OptiRoute plan via UI; create trips from plan; dispatch; driver starts trip, completes every stop and the trip; manager creates and issues an invoice; logged-out QR verification page; driver-unavailable scenario evaluated and approved; Control Tower afterwards; read-only viewer has no write buttons.

## Not verified here

| Item | Why | How to verify on your PC |
|---|---|---|
| `prisma migrate deploy` / `prisma migrate dev` through the Prisma CLI | The CLI downloads its native schema engine from `binaries.prisma.sh`, which this sandbox's "package managers only" allowlist blocks. The same migration SQL was applied directly with `psql` and by the integration-test setup. | `npm run db:deploy` |
| Hand-written v2 migration exactly matches `schema.prisma` (no drift) | Needs the same schema engine. The full integration suite, run through the generated Prisma client, passed against the migrated schema. | `cd backend; npx prisma migrate dev --create-only --name drift_check` should report that the schema is already in sync. If it creates a migration, inspect it and either keep or delete it. |
| Windows / PowerShell specifics | Sandbox is Linux. | Follow the README quick start. |
| Interactive dev mode (`npm run dev`) | Production servers were tested instead. | `npm run dev` |
| `docker compose up --build` (Dockerfiles, compose file) | Docker Hub is blocked in this sandbox, so base images could not be pulled. The YAML parses and the standalone Next.js server was tested. | `docker compose up --build` |
| GitHub Actions workflow on GitHub itself | Runs after you push; the same commands passed locally. | Push to `main` and open the Actions tab |
| Free-tier deployment (Neon, Render, Vercel) | Needs your accounts. | Follow `docs/DEPLOYMENT.md` |

## Known remaining audit finding (development-only)

`npm audit` in `frontend/` reports `braces` (high, GHSA-vfj7-8cjw-p6xm) through `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch`. It is a lint-time dependency only (not shipped to the browser or server). No patched version is available: the only fix npm offers is downgrading `eslint-config-next` to 14.x, which is incompatible with Next 16.

## Changes made during verification

- **Next.js 16.3.4 → 16.4.2** and eslint-config-next to match: 16.3.4 has a critical advisory (GHSA-vcvr-r3jv-pc5j and others).
- **Vitest 3 → 5** and esbuild 0.25 → 0.28: Vitest 3 pulls in a critical tinypool advisory.
- Integration-test setup now applies the committed migration SQL directly, so tests no longer need the Prisma CLI's native engine.
- OptiRoute local search gained an *exchange* move, so more orders get served (see `docs/OPTIROUTE.md`).
- Integration-test data bug fixed (a customer name was shorter than the 2-character minimum).
- The map now labels each place only once.
- The "Unserved penalty" label is now correct.
- Removed an unused ESLint directive.
- Frontend Vitest config renamed to `.mts`.
