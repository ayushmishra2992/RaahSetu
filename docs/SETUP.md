# Local setup on Windows (PowerShell)


## 0. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | **22 LTS (22.12 or newer)** — 20.19+ and 24 also work | `node -v` |
| npm | 10+ (bundled with Node) | `npm -v` |
| PostgreSQL | **15, 16 or 17** (tested schema on 16) | `psql --version` |
| Git | any recent | `git --version` |

Install PostgreSQL from <https://www.postgresql.org/download/windows/> and remember the password you set for the `postgres` superuser. If `psql` is not recognised, use its full path, e.g. `& "C:\Program Files\PostgreSQL\16\bin\psql.exe"`.

## 1. Extract and open

```powershell
Expand-Archive -Path "$HOME\Downloads\raahsetu.zip" -DestinationPath "$HOME\Projects"
cd "$HOME\Projects\raahsetu"
code .
```

Open two terminals in VS Code (**Terminal → New Terminal**, then the split button) — both start in the project root.

## 2. Install dependencies

```powershell
npm run setup
```

This runs `npm install` in the root, `backend/` and `frontend/` using the committed `package-lock.json` files (the backend install also runs `prisma generate`). For a strictly reproducible install use `npm run setup:ci`.

On first use, the Prisma CLI downloads its native schema engine from `binaries.prisma.sh` (needed by `db:deploy` / `db:migrate`). Normal internet access is enough; on a locked-down network allow that host.

## 3. Create the databases

Choose your own password instead of `CHANGE_ME` (keep it out of Git).

```powershell
psql -U postgres -h localhost -c "CREATE ROLE raahsetu WITH LOGIN PASSWORD 'CHANGE_ME' CREATEDB;"
psql -U postgres -h localhost -c "CREATE DATABASE raahsetu OWNER raahsetu;"
psql -U postgres -h localhost -c "CREATE DATABASE raahsetu_test OWNER raahsetu;"
```

`raahsetu_test` is only used by the integration tests and is **wiped on every test run**.

## 4. Configure environment variables

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

## 5. Apply migrations and (optionally) load demo data

```powershell
npm run db:deploy
npm run db:seed
```

`db:deploy` applies the committed migrations to a fresh (or the previous v1) database. `db:seed` creates **development-only** demo companies, users, fleet, a synthetic Mumbai–Pune–Nashik road network, pending orders for tomorrow and some history. It is idempotent — re-run it any time to refresh the demo delivery windows.

## 6. Start the backend and frontend

Terminal 1:

```powershell
npm run dev:backend
```

Terminal 2:

```powershell
npm run dev:frontend
```

(or run both in one terminal with `npm run dev`).

## 7. Open the app

| What | URL |
|---|---|
| Web app | <http://localhost:3000> |
| Login | <http://localhost:3000/login> |
| API health | <http://localhost:5000/api/health> (`"database": "ok"` when PostgreSQL is reachable) |
| API through the web app's proxy | <http://localhost:3000/api/health> |

## 8. Try the main workflow

1. Log in as `dispatcher@demo.raahsetu.local`.
2. **OptiRoute** → click *Tomorrow 08:00* → *Optimise routes*. Review routes, unserved reasons, excluded vehicles (one has an expired PUC), objective breakdown and assumptions.
3. *Create trips from plan* → **Trips** → open a trip → *Dispatch*.
4. Log in as `driver@demo.raahsetu.local` (or stay as dispatcher) → *Start trip* → mark stops *Picked up / Delivered* → *Complete trip*.
5. **Scenarios** → base plan = your run → *Vehicle breakdown* → compare → log in as `manager@…` to approve.
6. **Invoices & challans** → create an invoice for the completed trip → *Issue* → scan or open the QR link (works logged out).
7. **Control Tower** and **GreenFleet** show the results.

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
