# Contributing to RaahSetu

Thank you for your interest in improving RaahSetu. This guide covers how to set up the project, the conventions the codebase follows, and what a pull request needs to pass.

## Getting set up

Follow [docs/INSTALLATION.md](docs/INSTALLATION.md). In short:

```bash
npm run setup:ci
cp backend/.env.example backend/.env           # set DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET
cp frontend/.env.example frontend/.env.local
npm run db:deploy
npm run dev
```

Use a **separate, disposable** database for `TEST_DATABASE_URL` — the integration tests wipe it on every run.

## Workflow

1. Open an issue first for anything larger than a small fix, so the approach can be agreed.
2. Create a branch from `main`: `feature/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
3. Keep pull requests focused; one logical change per PR.
4. Write commit messages in the imperative mood with a short summary line, e.g. `Add reverse geocoding to the location picker`.

## Before opening a pull request

All of these must pass (CI runs the first four):

```bash
npm run typecheck
npm run lint
npm test                      # needs TEST_DATABASE_URL for the integration suite
npm run build
npm --prefix frontend run test:e2e   # browser tests, when you change the UI
```

- Add or update tests with every behaviour change: unit tests for pure logic, integration tests for API behaviour (including tenant isolation and permissions for new endpoints), Playwright tests for user-facing flows.
- Never weaken an existing test to make it pass; if a behaviour change makes a test obsolete, update it and explain why in the PR.
- Update the relevant document in `docs/` when you change behaviour, configuration or the API.

## Code conventions

- **TypeScript strict** on both sides; avoid `any`.
- **Backend:** one folder per area in `backend/src/modules/`; validate every body/query with Zod; protect every route with `requirePermission(...)`; always scope queries with `companyId` from `req.auth` and verify that referenced records belong to the same company; write an audit event for significant changes (never secrets); throw `AppError` helpers for expected errors.
- **Permissions:** add new permissions to `backend/src/lib/permissions.ts` (the single source of truth) and, for new pages, to `frontend/src/lib/nav.ts`.
- **Database:** change `backend/prisma/schema.prisma`, generate a migration with `npm --prefix backend run db:migrate -- --name <description>` against a disposable database, prefer additive changes, and commit the migration with the schema. Never edit an already-committed migration.
- **Frontend:** use the design system in `frontend/src/components/ds` (and its tokens in `globals.css`) instead of ad-hoc styles; keep pages responsive (tables need a `mobileCard` below 768 px) and accessible (one `h1`, labelled controls, keyboard support).
- **Third-party services:** call them from the backend only, keep keys in environment variables, never log URLs that contain keys, and make the feature degrade gracefully when the key is missing.
- **Honest data:** label estimates, simulations and sample data as such in the UI.

## Secrets

Never commit `.env` files, keys, certificates, database dumps or uploaded documents — `.gitignore` already excludes them; check `git status` before committing. Only `*.env.example` files with placeholders belong in the repository. If a secret is committed by mistake, rotate it immediately (removing the file later does not remove it from history).

## Reporting security issues

Please do not open a public issue. See [docs/SECURITY.md](docs/SECURITY.md#reporting-a-vulnerability).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
