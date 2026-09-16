# Jewellery Virtual Try-On Platform

A production-oriented web platform for photorealistic virtual jewellery try-on: a
customer photographs or uploads a picture of themselves, browses a jewellery catalogue,
and sees the *actual* selected piece placed on their photo.

**Current milestone: Milestone 3 — User Image Pipeline.** See [Current status](#current-status)
below for exactly what is and is not implemented yet.

## Architecture at a glance

```
apps/web      Next.js + TypeScript frontend (landing page, Try-On Studio, admin shell)
apps/api      FastAPI backend — HTTP layer only, never runs AI inference in-request
ai/           Try-on engine abstraction + CV modules (no AI implemented yet — Milestone 4+)
workers/      Independent worker process (heartbeat now; job consumer in Milestone 4+)
evaluation/   Placement/quality evaluation harness and datasets (Milestone 4+)
infrastructure/  nginx/deployment config (not used yet at this milestone)
docs/         Architecture, research, and process documentation
```

Full architecture rationale: [`docs/architecture.md`](docs/architecture.md). AI/model
research and licensing: [`docs/ai-research.md`](docs/ai-research.md) and
[`docs/model-comparison.md`](docs/model-comparison.md). Security/privacy/cost analysis:
[`docs/production-readiness.md`](docs/production-readiness.md). Milestone plan:
[`docs/roadmap.md`](docs/roadmap.md).

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

> **Known limitation of this development sandbox:** the Docker images for this stack
> (`python:3.11-slim`, `postgres:16-alpine`, `redis:7-alpine`, `minio/minio`,
> `node:22-slim`) could not be pulled from inside the cloud sandbox this was built in —
> its outbound network policy blocks all container registries (Docker Hub, GHCR, GCR,
> Quay, MCR, ECR Public all returned `403`). `docker compose build`/`up` were therefore
> **not** run end-to-end in that sandbox. Everything Docker-independent was verified for
> real instead (see [`docs/development.md`](docs/development.md) "How Milestone 1 was
> verified" for the full, honest account): the FastAPI app, the worker process, and the
> Alembic migration were run directly against a real local PostgreSQL and Redis (native
> processes) plus an S3-compatible mock, and `/health`/`/ready` were confirmed to report
> real dependency state, including degrading correctly when Postgres was stopped and
> recovering when it came back. `docker compose config` validates the compose file
> syntactically. **Running `docker compose build && docker compose up` on a normal
> developer machine with standard internet access is the first verification step for
> anyone picking this up**, since it was not possible in the build sandbox.

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

**Planned, not implemented yet:**
- Geometry try-on engine (Milestone 4)
- Additional categories + generative-AI evaluation gate (Milestone 5)
- Occlusion/shadow quality pass (Milestone 6)
- Full auth enforcement (registration, refresh tokens, persisted sessions), rate
  limiting, retention policies, CI/CD (Milestone 7)

**Known issues:**
- `docker compose build`/`up` unverified in this sandbox (see above) — verify on a
  machine with normal internet access before relying on it.
- SAM2 is not integrated (see above) — `rembg`/U-2-Net is a real, working substitute,
  not the originally-selected model.
- MediaPipe's Tasks API is not integrated (see Milestone 3 note above) — the Solutions
  API is a real, working substitute, but only produces a binary person segmentation
  mask (no separate hair/skin/clothing sub-masks).
- The admin catalogue UI's session is in-memory only (a page refresh logs the admin
  out) — a deliberate, minimal-scope decision for Milestone 2, not a bug.
- Google Fonts (`next/font/google`) could not be used for the same registry/egress
  reason and was replaced with a system font stack; revisit with self-hosted webfonts
  during the Milestone 7 branding pass if a custom typeface is wanted.
