# Deployment

Three ways to run RaahSetu outside local development. Whatever you choose, read the [production checklist](SECURITY.md#production-checklist) first.

| Option | Best for | Pieces |
|---|---|---|
| A. Docker Compose | A single VM or a local all-in-one demo | PostgreSQL 16 + API + web, built from the repo's Dockerfiles |
| B. Managed services | A free/low-cost public demo | Managed PostgreSQL (e.g. Neon) + API host (e.g. Render) + web host (e.g. Vercel) |
| C. Any Node host | Your own servers | `npm run build`, `npm run db:deploy`, `npm start` behind a reverse proxy |

Provider names, free tiers and dashboards change — check each provider's current documentation.

## Build artefacts

```bash
npm run setup:ci
npm run build
```

- Backend: `prisma generate` + type-check + esbuild bundle → `backend/dist/server.js` (run with `npm --prefix backend start`).
- Frontend: Next.js production build in `frontend/.next` (run with `npm --prefix frontend start`). Setting `NEXT_OUTPUT=standalone` at build time produces a self-contained server (used by the Docker image).
- `BACKEND_URL` and `NEXT_PUBLIC_*` variables are read **at build time** by the frontend (rewrites and inlined values); rebuild after changing them.

## A. Docker Compose

> The Compose files are part of the repository but were not re-run during the latest verification (no Docker on that machine).

```bash
cp .env.example .env      # set POSTGRES_PASSWORD and JWT_SECRET (placeholders must be replaced)
docker compose up --build -d
```

- `db`: `postgres:16-alpine` with a named volume `pgdata`.
- `backend`: applies migrations on start (`prisma migrate deploy`); loads demo data only when `SEED_DEMO=true` (the default in `.env.example` — set it to `false` for anything but a demo); uploads in the `uploads` volume.
- `frontend`: Next.js standalone server; `BACKEND_URL=http://backend:5000` and `NEXT_PUBLIC_DEMO_MODE` are build arguments.
- Location search: set `PLACES_PROVIDER=locationiq` and `PLACES_API_KEY=…` in the root `.env` (passed only to the backend container).

Open `http://<server>:3000`. Put a reverse proxy with HTTPS (Caddy, Nginx, Traefik) in front, then set `COOKIE_SECURE=true`, `CORS_ORIGIN` and `PUBLIC_APP_URL` to the public URL (add them to the `backend` service's `environment` in `docker-compose.yml`).

## B. Managed services (example: Neon + Render + Vercel)

### 1. Database — Neon (or any managed PostgreSQL 15+)

Create a database and copy its connection string (with `sslmode=require`). Keep it secret; it goes only into the API host's environment.

### 2. API — Render (or any Node host)

New **Web Service** from your GitHub repository:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build command | `npm ci && npm run build` |
| Start command | `npx prisma migrate deploy && npm start` |

For a **public demo only**, the start command can also load the demo data: `npx prisma migrate deploy && npm run db:seed && npm start` (requires `ALLOW_DEMO_SEED=true`; it recreates the demo companies on every restart — never do this with real data).

Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the managed PostgreSQL connection string |
| `JWT_SECRET` | a new random 48-byte string (never reuse a local one) |
| `CORS_ORIGIN` | `https://<your-web-app-domain>` |
| `PUBLIC_APP_URL` | `https://<your-web-app-domain>` (used in QR codes) |
| `COOKIE_SECURE` | `true` |
| `AUTH_RATE_LIMIT_PER_15_MIN` | e.g. `300` if all users arrive through the web host's proxy (one client IP) |
| `PLACES_PROVIDER`, `PLACES_API_KEY` | optional — `locationiq` and your own key |
| `ALLOW_DEMO_SEED` | `true` **only** for a demo that runs the seed |

Check `https://<your-api-host>/api/health` → `"database": "ok"`.

Uploaded documents (vehicle/driver documents, E-Way Bill copies, POD photos and signatures) go to the storage driver in `STORAGE_DRIVER`. The default `local` writes to `UPLOAD_DIR` on the instance disk, which **Render's free plan wipes on every deploy and restart** — `/api/health` then reports `storage.persistent: false`. For real use set `STORAGE_DRIVER=s3` with a private S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO); see [DOCUMENTS_AND_COMPLIANCE.md § Document storage](DOCUMENTS_AND_COMPLIANCE.md#8-document-storage). Check the provider's pricing first. Migration `20261118120000_transport_documents_compliance` must be applied (`prisma migrate deploy` in the start command does this) before the new features work.

### 3. Web — Vercel (or any Next.js host)

Import the repository:

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework | Next.js |
| `BACKEND_URL` | `https://<your-api-host>` |
| `NEXT_PUBLIC_DEMO_MODE` | `true` for a demo with the seed loaded, otherwise `false` |
| `NEXT_PUBLIC_MAP_TILE_URL` | a tile provider suitable for your traffic (see below) |

The web host proxies `/api/*` to the API, so the session cookie stays first-party.

## C. Plain Node host

```bash
npm run setup:ci
npm run build
npm run db:deploy          # with DATABASE_URL pointing at the production database
npm start                  # API on PORT (5000), web on 3000
```

Run both processes under a supervisor (systemd, PM2, a container platform) behind an HTTPS reverse proxy that forwards to the web app on port 3000.

## Maps in production

The default tiles come from OpenStreetMap's public tile server, which is intended for light use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/). For real traffic set `NEXT_PUBLIC_MAP_TILE_URL` (and `NEXT_PUBLIC_MAP_ATTRIBUTION`) to a commercial tile provider or your own tile server, then rebuild the frontend. Setting it to `none` shows the built-in schematic map instead.

## Location search in production

- Use your own LocationIQ key (`PLACES_PROVIDER=locationiq`, `PLACES_API_KEY`) on the API host only.
- Choose a plan that covers your expected searches (each pause while typing is one request; reverse lookups only on demand) and keep `PLACES_RATE_LIMIT_PER_MIN` at or below the provider's per-minute limit.
- Confirm the provider's terms for commercial and multi-tenant use, attribution and storage of results before going live.

## Updating a deployment

1. Back up the database (see [DATABASE.md](DATABASE.md#backups)).
2. Deploy the new code; run `npm run db:deploy` (or let the container/start command do it) — committed migrations are additive and applied in order.
3. Check `/api/health` and log in.
