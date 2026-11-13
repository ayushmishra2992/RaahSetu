# Security

This document describes the security controls implemented in RaahSetu, the known gaps, and how to report a vulnerability. Every control listed here is in the code; file references point to where.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting (the repository's **Security** tab → *Report a vulnerability*) and include steps to reproduce. You will get an acknowledgement, and a fix or mitigation will be coordinated before details are made public.

## Secrets and configuration

- Real configuration lives only in untracked files: `backend/.env`, `backend/.env.dev`, `frontend/.env.local` and the root `.env` used by Docker Compose. `.gitignore` excludes `.env` and `.env.*` (except `*.env.example`), key/certificate files (`*.pem`, `*.key`, `*.p12`, `*.pfx`), database dumps (`*.dump`, `*.sql.gz`, `*.backup`), uploads and build output.
- The committed `*.env.example` files contain **placeholders only** (`CHANGE_ME`, `REPLACE_WITH_…`).
- `backend/src/config/env.ts` validates the environment at start-up and refuses a `JWT_SECRET` shorter than 32 characters.
- The server logs the database **name and host** at start-up, never the connection string.
- `NEXT_PUBLIC_*` variables are compiled into browser code; RaahSetu uses them only for non-secret settings (demo-mode flag, map tile URL and attribution).
- The CI workflow uses a throwaway PostgreSQL password (`ci-only-password`) for its disposable service container; it protects nothing outside CI.

## Authentication

| Control | Implementation |
|---|---|
| Password storage | bcrypt, cost 12 (`backend/src/modules/auth/auth.routes.ts`, `users.routes.ts`) |
| Password policy | 8–128 characters with at least one letter and one digit (`zPassword`); mirrored in the UI |
| Login timing | Unknown emails are compared against a dummy hash so response time does not reveal which emails exist |
| Session token | JWT signed with HS256 and `JWT_SECRET`; lifetime `JWT_EXPIRES_IN` (default 8 h) |
| Cookie | `rs_token`, `httpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`, path `/` |
| Non-browser clients | The login response also returns the token for `Authorization: Bearer <token>` |
| Every request | `authenticate` verifies the JWT and loads the user from the database; deactivated or deleted users are rejected immediately |
| Rate limiting | `/api/auth/*`: `AUTH_RATE_LIMIT_PER_15_MIN` requests per IP per 15 minutes (`429 RATE_LIMITED`) |
| Post-login redirect | `safeNext()` (`frontend/src/lib/redirect.ts`) only allows same-origin paths, blocking `//host` and `/\host` open redirects |

## Authorisation and tenant isolation

- A single role → permission matrix (`backend/src/lib/permissions.ts`) is enforced with `requirePermission(...)` on every protected route. The frontend receives the caller's permission list from `/api/auth/me` and hides pages/actions accordingly — this is a convenience only; the API is authoritative.
- `companyId` always comes from the authenticated user; client-supplied `companyId` values are ignored. Records are looked up with `{ id, companyId }`, and references to other records (locations, vehicles, drivers, orders, trips, road nodes/edges, the base run of a scenario) are checked to belong to the same company. Cross-company access returns **404**.
- Drivers can only progress their own trips; the last admin of a company cannot be demoted or deactivated, and users cannot demote or deactivate themselves.
- These rules are covered by the integration tests (`backend/tests/integration/api.test.ts`: tenant isolation, role matrix, client-supplied `companyId`).

## Input handling and errors

- Zod schemas validate every request body and query (`backend/src/lib/validate.ts`); unknown fields are dropped.
- JSON bodies are limited to 1 MB.
- Errors use one format, `{ error: { code, message, details } }`. Unexpected errors return a generic `500 INTERNAL` message; details are logged on the server only.
- Prisma unique/foreign-key/serialisation errors map to 409 responses without leaking SQL.

## HTTP hardening

- **API:** Helmet defaults (including `X-Content-Type-Options`, `X-Frame-Options` and `Strict-Transport-Security`, which browsers honour over HTTPS), `x-powered-by` disabled, CORS restricted to `CORS_ORIGIN` with credentials, `trust proxy` set to one hop for correct client IPs behind a proxy.
- **Web app:** `next.config.ts` sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY`; `poweredByHeader` is off.
- **Same-origin API:** the browser calls `/api/*` on the web app's origin, which Next.js proxies to Express, so the session cookie is first-party and the API needs no permissive CORS.

## File uploads (compliance documents)

`backend/src/modules/documents/`:

- Accepted types: PDF, PNG, JPEG, WEBP — checked against an allow-list **and** the file's magic bytes (`storage.ts`).
- Size limit `MAX_UPLOAD_MB`, one file per request, held in memory until validated.
- Stored under `UPLOAD_DIR/<companyId>/<random 128-bit key>`; never served statically.
- Downloads go through an authenticated, tenant-checked endpoint with `Content-Disposition: attachment`, a sanitised filename and `X-Content-Type-Options: nosniff`.

## Public QR verification

- Trips, invoices and challans get a random 144-bit `verificationToken` (`backend/src/lib/tokens.ts`).
- `/api/public/verify/:token` returns only minimal fields (document number, status, company name, totals or trip summary) and is rate-limited to 60 requests per minute per IP.

## Third-party API keys (location search)

- The LocationIQ/Geoapify key is read only by the backend (`PLACES_API_KEY`). The browser calls RaahSetu's `/api/places/*`; the provider URL (which contains the key) is built on the server.
- Provider URLs are never logged or placed in error messages; logs record only the provider name, failure reason and HTTP status.
- Searches require `locations:write`, are rate-limited per company (`PLACES_RATE_LIMIT_PER_MIN`), sent with `Cache-Control: no-store`, and not cached on the server.
- Tests run with `PLACES_PROVIDER=none`, so no test can call a real provider.
- The release audit (below) confirmed the key does not appear in the production frontend bundle.

## Audit log

Significant changes (users, company settings, vehicles, drivers, documents, locations, road network, orders, billing, fuel records, password changes) are recorded in `AuditEvent` with minimal metadata. Passwords, tokens and request bodies are never stored. Trip status changes, OptiRoute runs and scenario decisions are **not yet** audited (see Known gaps).

## Demo data

`backend/prisma/seed.ts` is for local development and public demos only. Its demo accounts share the public password `Demo@1234`. The seed refuses to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`, and only replaces the two demo companies it creates. Never enable demo mode or `ALLOW_DEMO_SEED` on a deployment holding real company data.

## Dependencies

- `npm audit --omit=dev` (production dependencies) reports **0 vulnerabilities** for backend and frontend (checked 13 Nov 2026).
- The full audit reports moderate advisories in **development-only** tooling: `minimatch` via `typescript-eslint` (lint only, not shipped). Upgrade `typescript-eslint` when convenient.
- Installs use the committed lockfiles (`npm run setup:ci`).

## Known gaps

- No Content-Security-Policy header yet.
- No multi-factor authentication, password reset or account lockout beyond rate limiting.
- Logout clears the cookie; a copied Bearer token stays valid until it expires (deactivating the user revokes access immediately).
- Uploads are stored on local disk; production deployments should use object storage with encryption at rest.
- Trip, OptiRoute and scenario events are not in the audit log.

## Production checklist

- [ ] New random `JWT_SECRET` (never reuse a development one); strong database password.
- [ ] HTTPS everywhere; `COOKIE_SECURE=true`; `CORS_ORIGIN` and `PUBLIC_APP_URL` set to the real domain.
- [ ] `NEXT_PUBLIC_DEMO_MODE=false`; `ALLOW_DEMO_SEED` unset; do not run the demo seed.
- [ ] Location-search key restricted in the provider dashboard (where supported) and kept only in the backend's environment.
- [ ] A tile provider suitable for production traffic in `NEXT_PUBLIC_MAP_TILE_URL`.
- [ ] Regular database backups; `UPLOAD_DIR` on persistent, backed-up storage.
- [ ] `npm audit --omit=dev` clean.

## Release audit (13 Nov 2026)

Performed before the first public release:

| Check | Result |
|---|---|
| Sensitive files (`.env*`, dumps, keys, certificates) ever committed in Git history | None — only `*.env.example` and migration SQL |
| Real secret values (database password, JWT secret, LocationIQ key) in publishable files, all commits, commit messages and reflog | Not found |
| Same secrets in the production frontend build (`.next/static`, server output) | Not found |
| Credential-like strings in history | Only placeholders, the CI-only password, the test-only JWT secret and form/test field names |
| `.gitignore` covers `node_modules`, `.next`, `dist`, env files, dumps, uploads, keys | Yes |
| Local database dump in the working folder | Present but git-ignored (`*.dump`) — not publishable |
