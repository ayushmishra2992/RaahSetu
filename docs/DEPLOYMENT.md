# Deploy a free public demo

Goal: a live link for your resume, e.g. `https://raahsetu.vercel.app`, using free tiers:

| Part | Service | Free tier notes |
|---|---|---|
| PostgreSQL | [Neon](https://neon.tech) | Serverless Postgres; free tier is enough for the demo |
| API (Express) | [Render](https://render.com) Web Service | Free instances sleep after inactivity — the first request can take ~1 minute |
| Web (Next.js) | [Vercel](https://vercel.com) | Proxies `/api/*` to Render, so cookies stay first-party |

Free-tier limits and UIs change; check each provider's current pricing page.

## 1. Push the repo to GitHub
See the README "Publish to GitHub" section. The CI badge turns green after the first push.

## 2. Database — Neon
1. Create a project → copy the **pooled** connection string (`postgresql://…neon.tech/neondb?sslmode=require`).
2. Keep it secret; it goes only into Render's environment settings.

## 3. API — Render
New → **Web Service** → connect your GitHub repo.

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npx prisma migrate deploy && npm run db:seed && npm start` |

Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon connection string |
| `JWT_SECRET` | a new random 48-byte string (never reuse your local one) |
| `CORS_ORIGIN` | `https://<your-app>.vercel.app` |
| `PUBLIC_APP_URL` | `https://<your-app>.vercel.app` (used in QR codes) |
| `COOKIE_SECURE` | `true` |
| `ALLOW_DEMO_SEED` | `true` — **demo only**; the start command re-seeds the demo company on every restart |
| `AUTH_RATE_LIMIT_PER_15_MIN` | `300` (all visitors arrive through Vercel's proxy) |

Check `https://<your-api>.onrender.com/api/health` → `"database":"ok"`.

Uploaded documents are stored on the instance disk, which free Render instances do not keep across restarts. That is fine for a demo; for real use switch `backend/src/modules/documents/storage.ts` to S3/R2/GCS.

## 4. Web — Vercel
New Project → import the repo.

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework | Next.js (auto-detected) |
| `BACKEND_URL` | `https://<your-api>.onrender.com` |
| `NEXT_PUBLIC_DEMO_MODE` | `true` (shows one-click demo logins) |

Deploy, open the URL, click **Dispatcher** on the login page.

## 5. Optional — Docker on any VM
```bash
cp .env.example .env    # set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build -d
```
Then open `http://<server>:3000`. Put a reverse proxy with HTTPS (Caddy/Nginx) in front and set `COOKIE_SECURE=true` before using it beyond a demo.

## Demo-site checklist
- Demo banner/logins visible, data clearly synthetic ✅ (built in)
- No real company data on a site with `ALLOW_DEMO_SEED=true`
- Rotate `JWT_SECRET` if it was ever shared
