# Verification status

This repository was assembled in a sandbox **without access to the npm registry**, so dependencies could not be installed there. The table records exactly what was and was not executed before delivery.

| Check | Result in the build sandbox |
|---|---|
| Both migrations (`init` + `raahsetu_v2`) applied to a fresh PostgreSQL 16 database, each inside a single transaction | ✅ passed |
| OptiRoute optimiser + road-graph unit tests (18 tests) executed with `tsx` | ✅ 18/18 passed |
| Strict TypeScript check of the pure optimiser (`src/optimizer`, benchmark script) with TypeScript 6 | ✅ no errors |
| Benchmark script on synthetic instances | ✅ ran (results in `docs/OPTIROUTE.md`) |
| Syntax/JSX parse of all 100 `.ts`/`.tsx` files | ✅ no errors |
| Loose type-check of backend and frontend with third-party packages stubbed | ✅ no errors in project code (third-party types not checked) |
| `npm install` / lockfiles | ❌ **not run** — registry blocked; lockfiles are created by your first `npm run setup` |
| Full `tsc --noEmit` with real dependency types (backend + frontend) | ❌ not run |
| ESLint | ❌ not run |
| Vitest suites incl. integration tests against PostgreSQL | ❌ not run (integration tests need installed packages) |
| `prisma validate` / `prisma generate` / `prisma migrate deploy` via Prisma CLI | ❌ not run (SQL validated directly with `psql` instead) |
| `next build`, backend bundle, server start-up, browser flows | ❌ not run |

## Run the full acceptance check locally (PowerShell, project root)

```powershell
npm run setup                                   # creates package-lock.json files — commit them
cd backend; npx prisma validate; cd ..          # schema check via Prisma CLI
npm run db:deploy
npm run db:seed
npm run typecheck
npm run lint
npm test                                        # needs TEST_DATABASE_URL in backend\.env for integration tests
npm run build
npm run dev                                     # then open http://localhost:3000 and http://localhost:5000/api/health
```

If any step fails, copy the full error output — it will point at the exact file and line.
