# Deploying the backend (API + worker) to Render

This repo's `render.yaml` (at the repo root) defines two Render services:

- `jewellery-tryon-api` — the FastAPI app (`apps/api`), a Web Service with a public URL.
- `jewellery-tryon-worker` — the catalogue asset-processing worker (`workers`), a
  Background Worker (no public URL).

Both reuse your **existing** Neon Postgres, Upstash Redis, and Backblaze B2 credentials
from your local `.env` — no new database/redis/storage needs to be provisioned on Render.

## 1. Push `render.yaml` to GitHub

Already done if this file exists on `origin/master` alongside it. Render's Blueprint
feature reads this file directly from the repo.

## 2. Create the Blueprint on Render

1. Go to https://dashboard.render.com → **New** → **Blueprint**.
2. Connect the `vaibhaviBachu/Virtual_Tryon` GitHub repo (authorize Render if this is
   the first time).
3. Render detects `render.yaml` and shows both services (`jewellery-tryon-api`,
   `jewellery-tryon-worker`). Click **Apply**.
4. Render will ask you to fill in every env var marked `sync: false` before it can
   deploy — it leaves a form for exactly these. Keep this repo's local `.env` open
   (never committed) and copy values across:

   | Render env var | Copy from local `.env` | Notes |
   |---|---|---|
   | `DATABASE_URL` | `DATABASE_URL` | Neon connection string, unchanged |
   | `REDIS_URL` | `REDIS_URL` | Upstash `rediss://...`, unchanged |
   | `MINIO_ENDPOINT` | `MINIO_ENDPOINT` | Backblaze B2 endpoint, unchanged |
   | `MINIO_PUBLIC_ENDPOINT` (api only) | `MINIO_PUBLIC_ENDPOINT` | same as above here |
   | `MINIO_ACCESS_KEY` | `MINIO_ACCESS_KEY` | Backblaze application key ID |
   | `MINIO_SECRET_KEY` | `MINIO_SECRET_KEY` | Backblaze application key |
   | `JWT_SECRET_KEY` (api only) | — | **Do not reuse the local dev value.** Generate a new one: `python -c "import secrets; print(secrets.token_hex(32))"` |
   | `CORS_ALLOWED_ORIGINS` (api only) | — | Your deployed frontend origin, e.g. `https://virtual-tryon-blue.vercel.app` (comma-separate if you have more than one, e.g. a custom domain too) |

   Everything else (`ENVIRONMENT`, `MINIO_BUCKET`, `MINIO_SECURE`, `ENABLE_TRYON_DEBUG_VIZ`,
   etc.) is already set by `render.yaml` and needs no action.

5. Click **Apply** / **Create**. Render builds both Docker images (the worker image is
   large — it bakes in the rembg U-2-Net model — so its first build can take several
   minutes) and starts both services.

## 3. Verify the API is live

```
curl https://<your-api-service>.onrender.com/health
```

Should return `{"status":"ok",...}`. Then check the worker's logs in the Render
dashboard for `Catalogue asset processing consumer loop started` (same log line you've
seen locally) — that confirms it connected to Redis/Postgres/Backblaze correctly.

## 4. Point the frontend at the live API

In the Vercel project (`virtual-tryon-blue`) → **Settings** → **Environment Variables**:

- Set `NEXT_PUBLIC_API_URL` = `https://<your-api-service>.onrender.com`
- Redeploy the frontend (Vercel → Deployments → Redeploy on the latest commit) — this
  env var is inlined into the client bundle at build time, so a plain restart isn't
  enough, it needs a rebuild.

After that redeploy, `/try-on/live` on the live Vercel URL should load real catalogue
items and the model preview instead of "No items in this category yet" /
"Loading model preview…".

## Notes / gotchas specific to this repo

- Both Dockerfiles (`apps/api/Dockerfile`, `workers/Dockerfile`) `COPY` sibling
  top-level directories (`ai/`, `db/`, `storage/`, `jobqueue/`, ...) using paths
  relative to the **repo root**, not `apps/api/` or `workers/`. That's why
  `render.yaml` sets `dockerContext: .` — if the build context were scoped to the
  service's own subdirectory instead, the build would fail with "not found" on those
  `COPY` lines.
- The worker has no free Render plan — Background Workers require at least the
  `starter` plan. The API technically could run on `free`, but free web services spin
  down after 15 minutes of inactivity (slow cold starts on the next request); `starter`
  avoids that if it matters for your use case.
- Migrations run automatically on every API deploy (`entrypoint.sh` runs
  `alembic upgrade head` before `uvicorn` starts) — no separate migration step needed.
