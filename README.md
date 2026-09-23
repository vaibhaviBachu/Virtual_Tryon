# Jewellery Virtual Try-On Platform

A production-oriented web platform for photorealistic virtual jewellery try-on: a
customer photographs or uploads a picture of themselves, browses a jewellery catalogue,
and sees the *actual* selected piece placed on their photo.

**Current milestone: Milestone 5 — Live AR try-on.** The platform is deployed and live
(web on Vercel, API + worker on Render, Postgres on Neon, Redis on Upstash, object
storage on Backblaze B2) in addition to running locally via Docker Compose. See
[Current status](#current-status) below for exactly what is and is not implemented yet.

## Architecture at a glance

```
apps/web      Next.js + TypeScript frontend (landing page, photo Try-On Studio, Live AR
              camera studio, admin shell)
apps/api      FastAPI backend — HTTP layer only, never runs AI inference in-request
ai/           Try-on engine abstraction + CV modules (geometry-based GeometryTryOnEngine)
workers/      Independent worker process consuming Redis-queue jobs (catalogue asset
              processing, try-on request analysis, try-on render generation)
evaluation/   Placement/quality evaluation harness and datasets
infrastructure/  nginx/deployment config (used for local Docker Compose only — the live
              deployment runs on Vercel/Render directly, not this nginx config)
docs/         Architecture, research, and process documentation
```

Full architecture rationale: [`docs/architecture.md`](docs/architecture.md). Live AR
architecture and verification: [`docs/live-ar-architecture.md`](docs/live-ar-architecture.md)
and [`docs/live-ar-verification.md`](docs/live-ar-verification.md). AI/model research and
licensing: [`docs/ai-research.md`](docs/ai-research.md) and
[`docs/model-comparison.md`](docs/model-comparison.md). Security/privacy/cost analysis:
[`docs/production-readiness.md`](docs/production-readiness.md). Milestone plan:
[`docs/roadmap.md`](docs/roadmap.md).

## Live deployment

The platform runs in production on free/low-cost managed tiers:

| Layer | Platform |
|---|---|
| Web (Next.js) | Vercel |
| API + worker | Render (Docker-based web services, built from `apps/api/Dockerfile` and `workers/Dockerfile`) |
| Postgres | Neon |
| Redis | Upstash (TLS — `REDIS_URL` must use the `rediss://` scheme) |
| Object storage | Backblaze B2 (S3-compatible; the same `storage/s3_storage.py` abstraction works unmodified against MinIO, AWS S3, B2, or Cloudflare R2 — only endpoint/credentials differ) |

> **Operational caveat:** Render's Auto-Deploy has been unreliable for this project's API
> and worker services — pushing to `master` does not reliably trigger a new deploy on
> its own. After any backend-touching push, manually trigger "Deploy latest commit" for
> both the API and worker services in the Render dashboard.

## Prerequisites

- Docker Engine + Docker Compose v2 (`docker compose version`)
- For running things outside Docker: Node.js 22+, Python 3.11+, `pip`

## Environment variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Every port, credential, and URL the application uses is read from environment
variables — see `.env.example` for the full list and `docs/architecture.md` §2 for why
local ports start at 2001 instead of common defaults (3000/5432/6379/8000/9000, ...).

| Variable | Purpose |
|---|---|
| `WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `WORKER_PORT` | Local host port bindings |
| `DATABASE_URL` | Postgres connection string (container-internal, used by api/worker) |
| `REDIS_URL` | Redis connection string |
| `MINIO_*` | Object storage endpoint/credentials/bucket (S3-compatible; swap for AWS S3/Cloudflare R2 in production without code changes) |
| `JWT_*` | Auth token configuration (architecture is ready; no route enforces auth yet) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins |
| `NEXT_PUBLIC_API_URL` | API base URL baked into the frontend build |

## Running locally (Docker Compose)

```bash
cp .env.example .env
docker compose build
docker compose up
```

Once healthy:

- Web: http://localhost:2001
- API: http://localhost:2002 (docs at `/docs`, health at `/health`, readiness at `/ready`)
- Worker health: http://localhost:2007/health
- MinIO console: http://localhost:2006

`docker compose build && docker compose up` has been run and verified end-to-end
(all 6 services healthy, real Postgres/Redis/MinIO, real catalogue asset processing
through the worker) — this is the same Dockerfile-based build Render uses in
production, so local Compose and the live deployment stay in parity.

## Development commands

Backend (from repo root, with a virtualenv active):
```bash
pip install -r apps/api/requirements.txt -r workers/requirements.txt
pytest                      # runs apps/api/tests, ai/tests, workers/tests (pytest.ini)
alembic -c apps/api/alembic.ini upgrade head
uvicorn apps.api.main:app --reload --port 2002
```

Frontend (from `apps/web`):
```bash
npm install
npm run dev      # http://localhost:3000 in dev mode (docker-compose maps 2001 -> 3000)
npm run lint
npm run test      # vitest
npm run build
```

See [`docs/development.md`](docs/development.md) for the full development workflow and
[`docs/deployment.md`](docs/deployment.md) for staging/production deployment guidance.

## Current status

**Implemented (Milestone 1 — platform foundation):**
- Monorepo scaffold matching `docs/architecture.md`
- FastAPI app with structured JSON logging, request-ID propagation, centralized error
  handling, CORS, `/health` (liveness) and `/ready` (Postgres + Redis + object storage
  checks)
- SQLAlchemy + Alembic wired to Postgres with a baseline migration
- Redis client wrapper
- S3-compatible object storage abstraction (works against MinIO or real S3/R2 unmodified)
- Independent worker process with a Redis-backed heartbeat and its own `/health`/`/ready`
- `TryOnEngine` abstraction + registry with a `NotImplementedEngine` placeholder that
  honestly reports "not implemented" rather than fabricating a result
- `ai/models/LICENSES.md` model license registry, pre-populated from Milestone 0 research
- Next.js frontend: landing page, Try-On Studio state machine (placeholder data, real
  camera capture component with upload fallback), admin shell
- Docker Compose definition for all 6 services with health checks and persistent volumes

**Implemented (Milestone 2 — jewellery catalogue, see
[`docs/milestone-2-verification.md`](docs/milestone-2-verification.md) for the full
verification account):**
- Database-driven jewellery categories (9 seeded) + jewellery CRUD with physical
  dimension fields (`physical_width_mm`/`height_mm`/`depth_mm`/`weight_g`)
- `JewelleryAsset` model (original/processed/thumbnail variants) storing only
  object-storage keys and metadata, never binary data
- Admin-only asset upload: real content-based MIME sniffing, size/dimension limits,
  corrupt-image detection, EXIF stripping, orientation normalization
- Async background-removal + transparent-cutout + thumbnail pipeline running in the
  worker process via a minimal Redis job queue (`jobqueue/`) — never synchronously in
  the API request
- Background removal via `rembg`/U-2-Net (MIT/Apache-2.0) — a real, license-verified
  substitute for SAM2, which is blocked in this sandbox (huggingface.co returns 403;
  see `ai/models/LICENSES.md`)
- JWT-based admin authorization (`require_admin`) on every mutation endpoint, reusing
  Milestone 1's security primitives — no second auth system
- `/admin/catalogue` UI: category management, jewellery list with search/filter/
  pagination, creation form, detail page with original/processed/thumbnail preview on a
  checkerboard background showing real processing status (no fake progress bars)
- New, additive, reversible Alembic migration (`20260917_0002`) that does not modify the
  Milestone 1 baseline
- 76 backend/AI/worker pytest tests and 27 frontend Vitest tests, all passing; ESLint
  clean; production frontend build succeeds

**Implemented (Milestone 3 — user image pipeline, see
[`docs/milestone-3-verification.md`](docs/milestone-3-verification.md) for the full
verification account):**
- Guest-or-authenticated try-on sessions (`tryon_sessions`), private user-photo upload
  with real content-based validation, EXIF strip/orientation-normalize, and basic
  quality checks (blur/brightness/resolution) — all reusing/extending Milestone 1-2's
  validation and storage primitives, never a public URL
- Async worker pipeline (`workers/tasks/process_tryon_request.py`): face landmarks +
  ear-region heuristic, hand landmarks, pose/shoulder landmarks, person segmentation,
  and category-aware readiness (`FACE_READY`/`EARS_READY`/`NECK_READY`/`HANDS_READY`),
  each backed by real MediaPipe inference (see note below) with an honest low-confidence/
  not-detected state whenever a real result isn't reliable — never a fabricated one
- New, additive Alembic migration (`20260918_0003`) adding `tryon_sessions`,
  `user_images`, `tryon_requests` — the Milestone 1/2 migrations are untouched
- `/api/v1/tryon/*` endpoints for session/image/request creation, status polling, and
  landmark/segmentation retrieval (signed URLs only), with authorization preventing
  cross-session access
- Try-On Studio frontend: camera capture with review (Retake/"Use this photo", no
  auto-submit), lightweight photo guidance, real backend-status labels during
  analysis, and category-aware readiness display — no fake progress percentages
- 127 backend/AI/worker pytest tests and 32 frontend Vitest tests, all passing;
  10-scenario real-world evaluation dataset + script with honestly-reported results
  (`evaluation/`)
- **Model note:** MediaPipe's Tasks API is blocked in this sandbox (same
  `storage.googleapis.com` 403 pattern as Docker/SAM2); real MediaPipe inference is
  still used via the older Solutions API, whose weights ship inside the pip wheel
  (`mediapipe==0.10.9`) — see `ai/models/LICENSES.md` and the verification doc

**Implemented (Milestone 4 — basic geometry try-on, see
[`docs/milestone-4-verification.md`](docs/milestone-4-verification.md) for the full
verification account):**
- `GeometryTryOnEngine` for earrings and necklace: mathematically-defined anchor point
  (real face/pose landmarks) + documented scale + capped rotation + affine warp + true
  alpha compositing — no generative AI, no diffusion, no learned rendering model
- Catalogue asset metadata extended (`anchor_x`/`anchor_y`/`attachment_point`/
  `mirrorable`) and asset geometry always derived from the asset's real alpha bounding
  box, never the raw image rectangle
- Documented, configurable scaling with an honest physical-scale limitation
  (anthropometric calibration constants, not a per-user measurement) and safety clamps
  so a noisy landmark can never produce a nonsensical scale/rotation
- New, additive Alembic migration (`20260919_0004`) adding `tryon_renders` and the new
  asset columns — the Milestone 1-3 tables are untouched
- Async render pipeline (`POST /requests/{id}/render`, `GET /renders/{id}`) reusing
  Milestone 3's readiness gating and session/user authorization, with a `blocked` status
  distinct from `failed` for correctly-enforced preconditions (e.g. "ears not visible")
- Internal-only debug visualization endpoint (`GET /renders/{id}/debug`), never linked
  from the customer-facing UI
- Try-On Studio frontend wired to real categories/items/render/result, with an honest
  "not a photorealistic render" disclaimer during processing
- Real evaluation harness (`python -m evaluation.run_geometry`) reporting placement/
  scale/rotation error against by-hand-computed expected values (not the implementation
  grading itself) plus a real-image readiness/render agreement-rate check
- 191 backend/AI/worker pytest tests and 39 frontend Vitest tests, all passing

**Implemented (Milestone 5 — Live AR try-on, see
[`docs/live-ar-verification.md`](docs/live-ar-verification.md) for the full verification
account):**
- Real-time camera try-on (`/try-on/live`) — the primary "Try on" entry point, with an
  upload-a-photo path to the Milestone 3/4 Try-On Studio still reachable from it
- Client-side face/pose tracking via `@mediapipe/tasks-vision` (`FaceLandmarker`/
  `PoseLandmarker`), fetched and run entirely in the customer's browser — a different
  code path from the server-side MediaPipe Solutions API used in Milestone 3, and not
  subject to that path's constraints
- The SAME anchor/scale/rotation geometry as Milestone 4's `GeometryTryOnEngine`, ported
  to TypeScript (`apps/web/src/lib/live-ar/geometry.ts`) and kept numerically identical
  to the Python engine via a dedicated parity test (`live-ar-parity.test.ts`) — placement
  logic is not reimplemented twice
- Canvas 2D compositing, tracking-loss smoothing/fade, and FPS-aware throttling; see
  `renderer.ts`'s file header for why Canvas 2D (not WebGL/WebGPU) is the deliberate
  choice for this workload
- Simultaneous multi-item neck-item layering (e.g. a short necklace + a long haaram worn
  at once), each item independently tracked with a progressive vertical offset so pieces
  don't render on top of each other
- A static "catalogue model" reference preview (`BotPreview`) shown alongside the live
  camera, running the identical geometry pipeline against one MediaPipe IMAGE-mode
  detection pass on a fixed reference photo, so a customer can see a piece rendered
  cleanly even before the camera locks onto them
- Admin catalogue management extended with per-asset delete and permanent jewellery-item
  delete (both destructive, confirmation-gated, admin-only)
- A color-threshold "white background" cutout path added ahead of `rembg`/U-2-Net for
  near-white product photos, with size-limited hole-filling so it doesn't paint over a
  ring's or bangle's real interior opening
- Homepage category grid now shows real category icon images instead of placeholder text

**Planned, not implemented yet:**
- Occlusion/shadow/depth realism for jewellery in Live AR — attempted and explicitly
  reverted (see Known issues below); jewellery currently renders as a flat, geometrically
  correct overlay with no contact-shadow or depth cue
- Additional categories, and a generative-AI rendering path for the async photo flow
  (distinct from Live AR's real-time geometry engine) — not started
- Full auth enforcement (registration, refresh tokens, persisted sessions), rate
  limiting, retention policies, CI/CD (Milestone 7)

**Known issues:**
- Render's Auto-Deploy is unreliable for the API and worker services — see the
  "Operational caveat" under [Live deployment](#live-deployment).
- Jewellery in Live AR reads as an overlay rather than something genuinely worn — no
  contact shadow, occlusion, or depth cue. Three attempts at a Canvas 2D shadow effect
  (via `ctx.shadow*`, a manually-drawn silhouette, and `globalCompositeOperation:
  "source-atop"`) each broke visibly on a real device (invisible shadow, then a flat
  solid-gray block masking the whole canvas) and were fully reverted at the user's
  request rather than left half-working. Revisit with a different approach and
  real-device verification before every attempt, not three guesses in a row.
- SAM2 is not integrated (see below) — `rembg`/U-2-Net plus the white-background cutout
  path is a real, working substitute, not the originally-selected model.
- MediaPipe's server-side Tasks API is still not integrated for the Milestone 3 photo
  pipeline (see Milestone 3 note above) — the Solutions API remains the substitute
  there. Live AR's browser-side Tasks API (Milestone 5) is unaffected — it is fetched by
  the customer's browser, not this dev sandbox, so it isn't subject to the same block.
- The admin catalogue UI's session is in-memory only (a page refresh logs the admin
  out) — a deliberate, minimal-scope decision for Milestone 2, not a bug.
- Google Fonts (`next/font/google`) could not be used for the same registry/egress
  reason and was replaced with a system font stack; revisit with self-hosted webfonts
  during the Milestone 7 branding pass if a custom typeface is wanted.
- Milestone 4's jewellery placement uses a documented anthropometric average for
  physical scale (a single 2D photo has no metric depth reference) and in-plane-only
  rotation (no 3D head-pose correction) — see `docs/milestone-4-verification.md` §6-7.
- `ENABLE_TRYON_DEBUG_VIZ` defaults on in this development config; set it `false` in a
  production environment (the debug endpoint is never linked from the customer UI
  regardless).
