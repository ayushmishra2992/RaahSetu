# Installation

This guide takes you from a fresh clone to a running RaahSetu on your machine. Commands are shown for macOS/Linux (bash) with Windows PowerShell equivalents where they differ. Every `npm run …` command below exists in the repository's `package.json` files.

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | **22 LTS** recommended (see `.nvmrc`); `>= 20.19` required (24 also works) | `node -v` |
| npm | 10 or newer (bundled with Node) | `npm -v` |
| PostgreSQL | 15, 16 or 17 (CI uses 16) | `psql --version` |
| Git | any recent version | `git --version` |

- **PostgreSQL:** install from <https://www.postgresql.org/download/> and note the password of the `postgres` superuser. On Windows, if `psql` is not on your PATH use its full path, e.g. `& "C:\Program Files\PostgreSQL\16\bin\psql.exe"`.
- **Docker (optional):** only for the Docker Compose route in [DEPLOYMENT.md](DEPLOYMENT.md).

## 2. Clone

```bash
git clone https://github.com/<your-username>/RaahSetu.git
cd RaahSetu
```

## 3. Install dependencies

```bash
npm run setup:ci     # strict install from the three committed package-lock.json files
# or
npm run setup        # npm install in root, backend/ and frontend/
```

- The backend install runs `prisma generate` (its `postinstall`), creating the Prisma client in `backend/src/generated/` (git-ignored). Regenerate it any time with `npm --prefix backend run db:generate`.
- On first use the Prisma CLI downloads its schema engine from `binaries.prisma.sh`; allow that host on locked-down networks.
- npm 11 may print `install-scripts … not yet covered by allowScripts` for `unrs-resolver` (an ESLint helper). It is safe to ignore: lint and builds work without it.

## 4. Create the databases

Create a dedicated login role and two databases. Choose your own password instead of `CHANGE_ME` and keep it out of Git.

```bash
psql -U postgres -h localhost -c "CREATE ROLE raahsetu WITH LOGIN PASSWORD 'CHANGE_ME' CREATEDB;"
psql -U postgres -h localhost -c "CREATE DATABASE raahsetu OWNER raahsetu;"
psql -U postgres -h localhost -c "CREATE DATABASE raahsetu_test OWNER raahsetu;"
```

| Database | Used by | Notes |
|---|---|---|
| `raahsetu` | the application | Your data. |
| `raahsetu_test` | backend integration tests only | **Wiped on every test run** (its `public` schema is dropped and rebuilt). Never point it at a database you care about; the test setup refuses a URL whose database is named `raahsetu`. |

## 5. Configure environment variables

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # → JWT_SECRET
```

PowerShell: `Copy-Item backend\.env.example backend\.env` and `Copy-Item frontend\.env.example frontend\.env.local`.

Edit **`backend/.env`** (all other values have working defaults for local use):

```env
DATABASE_URL="postgresql://raahsetu:YOUR_PASSWORD@localhost:5432/raahsetu?schema=public"
TEST_DATABASE_URL="postgresql://raahsetu:YOUR_PASSWORD@localhost:5432/raahsetu_test?schema=public"
JWT_SECRET="paste-the-random-string-printed-above"
```

URL-encode special characters in the password (`@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`).

**`frontend/.env.local`** only needs changes if the API is not on `http://localhost:5000` (`BACKEND_URL`), or to change the map tiles. `NEXT_PUBLIC_DEMO_MODE="true"` shows one-click demo logins on the login page, which only work after loading the demo data (step 7).

Every variable is described in the README's [Configuration](../README.md#configuration) section and in the `.env.example` files.

## 6. Create the tables

```bash
npm run db:deploy
```

This runs `prisma migrate deploy`, applying the three committed migrations in `backend/prisma/migrations/` to the database in `DATABASE_URL`. It never drops data and is safe to re-run (already-applied migrations are skipped). Check the state with:

```bash
cd backend && npx prisma migrate status && cd ..
```

> `npm run db:migrate` (`prisma migrate dev`) is only for **creating new migrations** while changing `schema.prisma`; it can ask to reset a development database if it detects drift. `npm run db:reset` **deletes all data** in `DATABASE_URL`. Do not run either against data you want to keep.

## 7. (Optional) Load demo data

```bash
npm run db:seed
```

For a local, development database only. The seed creates two demo companies (identified by demo GST numbers) with users, fleet, compliance documents, a synthetic Mumbai–Pune–Nashik road network, pending orders for tomorrow and some trip/invoice history. It is idempotent: re-running it deletes and recreates **only those two demo companies and their demo users**, and it refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.

Demo logins (password `Demo@1234`, public by design — never use these accounts for real data):

| Email | Role |
|---|---|
| `admin@demo.raahsetu.local` | Admin |
| `manager@demo.raahsetu.local` | Manager |
| `dispatcher@demo.raahsetu.local` | Dispatcher |
| `viewer@demo.raahsetu.local` | Employee (read-only) |
| `driver@demo.raahsetu.local`, `driver2@demo.raahsetu.local` | Driver |
| `admin@other.raahsetu.local` | Admin of a second company (to see tenant isolation) |

Skip this step to start empty: open the app and choose **Register your company** to create your own admin account.

## 8. Start the application

```bash
npm run dev            # API on :5000 and web on :3000 in one terminal
```

or in two terminals:

```bash
npm run dev:backend    # Express API with auto-reload (tsx watch)
npm run dev:frontend   # Next.js dev server on :3000
```

| What | URL |
|---|---|
| Web app | <http://localhost:3000> |
| Login | <http://localhost:3000/login> |
| API health | <http://localhost:5000/api/health> → `"database": "ok"` |
| Same, through the web app's proxy | <http://localhost:3000/api/health> |

**Optional — separate local database:** `npm run dev:local` starts the API with `backend/.env.dev` loaded first (Node's `--env-file`), then fills any missing variables from `backend/.env`. Put only the values that differ (for example a `DATABASE_URL` for a separate development database) in `backend/.env.dev`; the matching `npm --prefix backend run db:deploy:local` / `db:status:local` scripts target the same file. `.env.dev` is git-ignored.

## 9. Enable location search (optional, your own LocationIQ key)

Without a key, location dialogs work with the map pin and manual coordinates. To enable address autocomplete and **Use pin's address**:

1. Sign up at <https://locationiq.com> and copy your access token.
2. Add to `backend/.env` (or `backend/.env.dev` if you use `npm run dev:local`):
   ```env
   PLACES_PROVIDER=locationiq
   PLACES_API_KEY=<your LocationIQ access token>
   ```
3. Restart the backend (environment files are read at start-up).
4. Check: as an admin, open **Locations & Roads → Add location** — the dialog shows **Search for a place**. `GET /api/places/status` (signed in) reports `"enabled": true, "provider": "locationiq"`.

The key is used only by the backend; never put it in `frontend/.env.local` or any `NEXT_PUBLIC_*` variable. Typing in a search box uses one request per pause; results are cached per dialog. Review LocationIQ's plan limits, attribution and commercial-use terms before production use.

## 10. Explore

1. Log in as `dispatcher@demo.raahsetu.local`.
2. **OptiRoute** → set the plan start to tomorrow 08:00 → *Optimise routes*. Review routes, unserved reasons, excluded vehicles (one has an expired PUC) and the objective breakdown.
3. *Create trips from plan* → **Trips & Dispatch** → open a trip → *Dispatch*.
4. As `driver@demo.raahsetu.local`: *Start trip* → mark stops *Picked up / Delivered* → *Complete trip*.
5. **Scenarios** → base the scenario on your run → *Vehicle breakdown* → compare → log in as `manager@…` to approve.
6. **Invoices & Challans** → create an invoice for the completed trip → *Issue* → open the QR link (works logged out).
7. **Control Tower** and **GreenFleet** summarise the results; **Audit log** (admin/manager) shows who changed what.

## 11. Run the checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

See [TESTING.md](TESTING.md) for what each suite covers and for the Playwright browser tests.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid backend environment configuration … JWT_SECRET` | Set a `JWT_SECRET` of at least 32 characters in `backend/.env`. |
| `/api/health` shows `"database": "unreachable"` or Prisma `P1001` | PostgreSQL is not running, or `DATABASE_URL` is wrong (password, port 5432, URL-encoding). |
| `Cannot find module '../generated/prisma/client'` | Run `npm --prefix backend run db:generate`. |
| Login page says it cannot reach the API | The backend is not running on `:5000`, or `BACKEND_URL` in `frontend/.env.local` is wrong (restart the frontend after changing it). |
| Integration tests are **skipped** | `TEST_DATABASE_URL` is not set in `backend/.env`. |
| OptiRoute: "No eligible vehicle…" | Vehicles need a depot, AVAILABLE status, unexpired RC/insurance/PUC/fitness/permit and an available driver with a valid licence; the error lists each exclusion. |
| Demo orders are all unserved | Their delivery windows are tomorrow: choose a plan start of tomorrow 08:00, or re-run `npm run db:seed`. |
| "Address search isn't set up" in location dialogs | Location search is optional; see step 9. |
| Port already in use | Change `PORT` in `backend/.env` (and `BACKEND_URL` in the frontend), or stop the other process. |
| `psql` not recognised (Windows) | Use the full path to `psql.exe` or add PostgreSQL's `bin` folder to PATH. |
