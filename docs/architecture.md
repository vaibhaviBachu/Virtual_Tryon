# Architecture — Jewellery Virtual Try-On Platform

Status: Milestone 0 design. No implementation yet.

## 1. Monorepo structure (accepted from spec, minor additions marked with *)

```
jewellery-virtual-tryon/
  apps/
    web/                      # Next.js + TypeScript frontend
    api/                      # FastAPI backend (HTTP layer only)
  ai/
    engines/                  # TryOnEngine implementations (geometry/, generative/, hybrid/)
    preprocessing/            # image validation, EXIF/orientation, resizing
    segmentation/             # person/hair/cloth masks, matting
    landmarks/                # face/hand/pose landmark wrappers
    rendering/                # compositing, shadow synthesis, warp math
    models/                   # model weights registry + download scripts (not committed to git)
  workers/*                    # * new: Celery/RQ/Arq worker entrypoints, separate from ai/ so the
                                #   queue-consumption concern is not mixed with the CV algorithms
  evaluation/
    data/
      jewellery/
      test_images/
      datasets/
    users/{front,45_degree,side}/
    jewellery/{earrings,necklaces,bangles,haaram}/
    expected/
    scripts/                  # * new: batch-run harness + metrics scripts
  infrastructure/
    docker/
    deployment/
    nginx/
  scripts/
  docs/
  docker-compose.yml
  .env.example
  README.md
```

Rationale for the one addition (`workers/`): the spec's `ai/` tree is about *algorithms*; the queue
consumer (Celery/RQ/Arq worker process) is *infrastructure glue* that imports from `ai/engines`.
Keeping them separate means the AI code has zero dependency on the queueing library, which keeps the
"model-specific code isolated" and "AI inference isolated from the main API" rules easy to enforce
and testable in isolation.

## 2. Local port plan (per your instruction — all local dev ports start at 2001, avoiding common
   defaults like 3000/5432/6379/8000/9000)

| Service | Port |
|---|---|
| Web (Next.js) | 2001 |
| API (FastAPI) | 2002 |
| PostgreSQL | 2003 |
| Redis | 2004 |
| MinIO API | 2005 |
| MinIO Console | 2006 |
| Worker metrics/health (internal) | 2007 |
| Nginx (local reverse proxy, optional) | 2008 |
| Flower / queue dashboard (optional, dev only) | 2009 |

These will be defined as env vars in `.env.example` (e.g. `WEB_PORT=2001`) so they stay
configurable per machine rather than hard-coded in `docker-compose.yml`.

## 3. Frontend architecture (Next.js + TypeScript + Tailwind + shadcn/ui)

- **Landing page** (`/`): marketing/explainer + category grid + CTA into Try-On Studio.
- **Try-On Studio** (`/try-on`): a single client-side state machine —
  `idle → capturing → previewing → selecting_category → selecting_item → processing → result → comparing`.
  Camera capture uses the browser `MediaDevices.getUserMedia` API with a graceful upload-only
  fallback (desktop without camera, permission denied, unsupported browser).
- **Admin app** (`/admin/*`, same Next.js app behind an auth-gated route group, or a separate
  route group in the same deployment for MVP simplicity): catalogue CRUD, asset upload/status,
  try-on history, basic analytics, system status.
- State/data fetching: React Query (server state) + a small Zustand/Context store for the in-progress
  try-on session (captured image, selected item, job id) — this avoids prop-drilling through the
  multi-step studio flow.
- Processing UX: job creation returns a `job_id` immediately; the UI polls
  `GET /api/v1/tryon/{id}` (see §6 for why polling over WebSocket for MVP) with a non-blocking
  spinner/progress state — the rest of the UI (category browsing, trying another item) remains
  interactive.

## 4. Backend architecture (FastAPI + PostgreSQL + SQLAlchemy + Alembic)

Service-oriented internal structure inside `apps/api`:
```
apps/api/
  main.py                # app factory, versioned router mounting
  core/                  # settings (pydantic-settings), logging, security, rate-limit middleware
  v1/
    routers/             # uploads, tryon, catalog, auth, admin
    schemas/             # pydantic request/response models
    services/            # business logic, calls into ai/engines via a thin client interface
  db/
    models/              # SQLAlchemy ORM models
    migrations/          # Alembic
  storage/               # object storage client abstraction (S3-compatible; MinIO locally)
  deps.py                # FastAPI dependency wiring (db session, current user, rate limiter)
```

Key design decision: **the API process never runs AI inference in-request.** It only creates a
`tryon_requests` row, enqueues a job, and returns `202 Accepted` with a job id. This keeps API p99
latency low and lets AI workers scale independently (including onto GPU-backed nodes later) without
touching the API layer.

## 5. Database schema (PostgreSQL, normalized)

```
users
  id (uuid, pk)
  email (unique)
  password_hash (nullable — supports future OAuth-only accounts)
  role (enum: customer, admin)
  created_at, updated_at

jewellery_categories
  id (pk)
  slug (unique, e.g. "earring", "necklace", "haaram", "bangle", "bracelet",
        "ring", "maang_tikka", "nose_ring", "set")
  display_name
  anchor_type (enum: ear, neck, wrist, finger, forehead, nose, multi)
  placement_config (jsonb)   -- category-specific defaults (e.g. default scale ratio,
                              -- rotation offset, z-order relative to hair/cloth layers)
  is_active (bool)

jewellery
  id (pk)
  category_id (fk -> jewellery_categories)
  sku (unique)
  name
  description
  physical_width_mm, physical_height_mm  -- for scale-accurate placement
  metadata (jsonb)           -- open-ended, category-specific attributes (spec's example JSON)
  is_active (bool)
  created_at, updated_at

jewellery_assets
  id (pk)
  jewellery_id (fk)
  asset_type (enum: original, transparent_cutout, thumbnail, mask)
  storage_key            -- object storage path, NOT the file itself
  width_px, height_px
  processing_status (enum: pending, processing, ready, failed)
  created_at

tryon_sessions
  id (pk)
  user_id (fk, nullable for anonymous/guest sessions)
  original_image_asset_key
  device_info (jsonb)      -- camera vs upload, user agent, for debugging/analytics
  created_at, expires_at   -- retention policy anchor

tryon_requests
  id (pk)
  session_id (fk -> tryon_sessions)
  jewellery_id (fk)
  engine_used (enum: geometry, generative, hybrid)  -- which TryOnEngine impl handled it
  status (enum: queued, processing, completed, failed)
  result_asset_key (nullable)
  error_message (nullable)
  queued_at, started_at, completed_at   -- for latency observability
  metrics (jsonb)           -- per-request placement metrics (scale used, landmark confidence, etc.)

-- Future entities (not built in MVP, referenced here so the schema won't need a rewrite):
jewellery_variants (id, jewellery_id fk, variant_attrs jsonb)
jewellery_sets (id, name) / jewellery_set_items (set_id fk, jewellery_id fk)
favorites (user_id fk, jewellery_id fk)
analytics_events (id, session_id fk, event_type, payload jsonb, created_at)
```

Design notes:
- No binary image data in Postgres anywhere — every asset table stores a `storage_key` pointing at
  object storage, per the spec's hard rule.
- `placement_config`/`metadata` are `jsonb` specifically so new jewellery categories or new
  per-category placement parameters never require a migration — this is what "extensible metadata
  system, no hard-coded category logic" means concretely at the schema level.
- `tryon_requests.engine_used` + `metrics` jsonb is what makes the evaluation framework
  (Milestone 5/6 geometry-vs-AI-vs-hybrid comparison) queryable directly from production data, not
  just from the offline `evaluation/` harness.

## 6. API design (versioned, matches spec's endpoint list)

```
POST   /api/v1/uploads                 -- upload/register a user photo, returns asset key
POST   /api/v1/tryon                   -- {session_id, jewellery_id} -> creates tryon_requests row,
                                           enqueues job, returns 202 + job id
GET    /api/v1/tryon/{id}              -- poll status/result
GET    /api/v1/catalog                 -- list categories/items (filterable, paginated)
GET    /api/v1/catalog/{id}
POST   /api/v1/catalog                 -- admin, creates jewellery + triggers asset pipeline
PUT    /api/v1/catalog/{id}            -- admin
DELETE /api/v1/catalog/{id}            -- admin (soft delete via is_active)
GET    /health                         -- liveness
GET    /ready                          -- readiness (checks db/redis/storage connectivity)
```
Auth: JWT-based, `role` claim distinguishes customer vs admin; admin-only routes protected by a
FastAPI dependency. Guest/anonymous try-on sessions are allowed for MVP (no forced signup to try
jewellery on), with `tryon_sessions.user_id` nullable — this was an explicit gap in the original
spec (no requirement said guests must be blocked) and is called out under "missing requirements."

**Async transport decision — polling over WebSocket/SSE for MVP:** try-on jobs are expected to
complete in low single-digit seconds (geometry engine) up to ~10–15s (if a generative refinement
step is added later). Short polling (e.g., every 1s, capped retries) is simpler to build, test, and
scale behind a plain load balancer than WebSocket/SSE connection state, and is indistinguishable in
UX from push at this latency. SSE is the recommended upgrade path if/when jobs regularly exceed
~15–20s, because it avoids client polling overhead without the bidirectional complexity of
WebSockets that this workflow doesn't need (server → client only).

## 7. Try-on pipeline (async job flow)

```
Frontend --POST /tryon--> FastAPI --enqueue--> Redis (queue) --consume--> Worker
Worker: load original image + jewellery asset from object storage
     -> preprocessing (orientation/validation already done at upload time)
     -> landmark detection (MediaPipe face/hand/pose per category anchor_type)
     -> segmentation (hair/skin/cloth masks for occlusion)
     -> TryOnEngine.render(image, jewellery_asset, landmarks, masks, placement_config)
          (GeometryTryOnEngine for MVP; Generative/Hybrid pluggable later)
     -> occlusion compositing (redraw hair/cloth mask regions back over the jewellery layer)
     -> shadow/lighting synthesis pass
     -> write result to object storage
     -> update tryon_requests row (status=completed, result_asset_key, metrics)
Frontend polls GET /tryon/{id} until status is completed/failed, then shows result + compare view.
```

`TryOnEngine` interface (abstract base), so no category- or model-specific logic ever leaks into the
API layer:
```
class TryOnEngine(ABC):
    def render(self, user_image, jewellery_asset, landmarks, masks, placement_config) -> RenderResult: ...

class GeometryTryOnEngine(TryOnEngine): ...   # MVP
class GenerativeTryOnEngine(TryOnEngine): ...  # post-MVP, optional refinement
class HybridTryOnEngine(TryOnEngine): ...      # composes the above
```
Engine selection is a config value (per-category or global), never an `if model == "x"` scattered
through the codebase.

## 8. Object storage layout (S3-compatible; MinIO for local dev)

```
bucket: user-uploads/       originals/{session_id}/{asset_id}.jpg          (private)
bucket: tryon-results/      results/{request_id}.jpg                      (private, signed URL out)
bucket: jewellery-assets/   originals/{jewellery_id}.jpg
                             cutouts/{jewellery_id}.png
                             thumbnails/{jewellery_id}.jpg
                             masks/{jewellery_id}.png                      (public-readable via CDN
                                                                             for catalogue assets;
                                                                             user photos never public)
```
All buckets private by default; user-photo and result buckets are always accessed via short-lived
signed URLs, even for the requesting user's own browser — the spec's "do not expose uploaded user
images publicly" rule is enforced at the bucket-policy level, not just in application code.

## 9. Deployment architecture

- **Development:** `docker-compose.yml` — web, api, postgres, redis, worker (CPU mode), minio. All
  ports per §2.
- **Staging:** same containers on a single small VM or a managed container service (e.g., Fly.io /
  Render / a single-node ECS); managed Postgres + managed Redis recommended even in staging to avoid
  data-loss surprises; object storage = real S3 or Cloudflare R2 (R2 preferred for egress cost).
- **Production:**
  - Web: static/edge-deployed (Vercel or a CDN-fronted Next.js deployment).
  - API: containerized, horizontally scaled behind a load balancer (stateless — safe to scale out).
  - Workers: **separate node pool from the API**, CPU-only pool for the MVP geometry engine
    (no GPU needed at all for MVP — this is a major cost win, see production-readiness.md), with a
    GPU pool added later only if/when a generative refinement engine ships.
  - Postgres: managed (RDS/Cloud SQL/Supabase), with read replica only if/when analytics load
    requires it — not day one.
  - Redis: managed (ElastiCache/Upstash) for the queue + rate limiting.
  - Object storage: S3 or Cloudflare R2, CDN in front of the public catalogue-asset paths only.
- **Scaling strategy:** API and worker pools scale independently and horizontally; the queue depth
  (Redis) is the primary autoscaling signal for the worker pool.

## 10. Extensibility guarantees this architecture provides

- New jewellery category = one new `jewellery_categories` row + a `placement_config` entry +
  (only if genuinely novel geometry) a new anchor-computation function — never a new code path
  through the API/DB/frontend.
- New AI model/engine = a new `TryOnEngine` subclass registered in a small factory/registry, selected
  via config — no rewrite of the worker, API, or frontend.
- New CV component (e.g., swapping MediaPipe pose for something else) is isolated behind the
  `ai/landmarks` and `ai/segmentation` module boundaries, consumed only by the engines, never
  imported directly by `apps/api`.
