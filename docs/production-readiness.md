# Production Readiness — Security, Cost, Risks, Missing Requirements

## 1. GPU / latency / cost analysis

**Key finding: the MVP (geometry/AR engine) needs no GPU at all.** MediaPipe landmark/segmentation
models run comfortably on CPU in tens of milliseconds; the compositing/warp/shadow math is plain
image processing (OpenCV/Pillow/NumPy or a small custom renderer). Estimated end-to-end worker
latency per try-on request: **150–500 ms** on a modest CPU instance. This is a major, deliberate cost
win versus jumping straight to a diffusion-based approach, and it is the direct payoff of the
research in `ai-research.md` (geometry-first, not generative-first).

GPU only enters the picture in two places, both **off the hot path**:
- Admin-side catalogue asset processing (SAM2 background removal): a few seconds per upload, run
  asynchronously, low volume (catalogue uploads, not customer traffic) — a single small GPU instance
  (e.g., T4/A10-class, ~4–8 GB VRAM) shared across all admin uploads is more than sufficient, or this
  can even be run on a pay-per-second serverless GPU endpoint to avoid an always-on GPU box entirely.
- A future optional "AI polish" pass (Milestone 6+): if/when added, expect an SDXL-class
  inpainting/harmonization model needing ~8–12 GB VRAM and 2–6 s per image on an A10/L4-class GPU —
  budget for this only once usage data justifies it.

**Cost implication:** MVP infrastructure cost is dominated by ordinary web/API/DB/storage hosting,
not GPU rental — a meaningful, non-obvious result of doing the model research before architecting.

## 2. Security

- Auth: JWT access + refresh tokens; admin routes require `role=admin`; password hashing via
  argon2/bcrypt.
- Uploaded/generated photos: private buckets only, signed URLs with short TTL, never a public path.
- Upload validation: MIME sniffing (not just extension), max file size, max/min resolution,
  malformed/corrupt-file rejection, EXIF orientation normalization, EXIF **stripping** on ingest
  (privacy — a phone photo's GPS EXIF must not be retained).
- Rate limiting: per-IP and per-account limits on `/uploads` and `/tryon` (Redis-backed token
  bucket), to control both abuse and generative-cost exposure once that path exists.
- CORS: explicit allowlist of frontend origin(s), no wildcard in production.
- Secrets: all via environment variables / secret manager, never committed; `.env.example` documents
  names only.
- Audit logging: structured logs for admin catalogue mutations and any access to another user's
  session data.
- HTTPS-ready: TLS terminated at the load balancer/CDN; app assumes `X-Forwarded-Proto`.

## 3. Privacy / retention

- Configurable retention policy (env-driven) for `tryon_sessions`/`tryon_requests` original and
  result images — default recommendation: purge originals after 24–72 hours unless the user has an
  account and explicitly saves a favorite; purge failed-job intermediate files immediately.
- Object storage lifecycle rules implement the actual deletion (not just DB soft-delete) so photos
  are genuinely gone, not just hidden.
- Admin access to raw user photos is logged (who viewed what, when) — necessary given photos are
  biometric-adjacent data (faces, hands).

## 4. Observability

- Structured JSON logs with a request ID propagated from API → queue → worker (so one try-on request
  is traceable end to end across processes).
- Per-stage timing recorded into `tryon_requests.metrics`: queue wait time, landmark time,
  segmentation time, render time, total — this both satisfies the spec's "AI inference timing / queue
  timing" requirement and feeds the evaluation framework.
- `/health` (liveness) and `/ready` (checks DB, Redis, storage connectivity) endpoints on the API;
  workers expose a lightweight internal health port (see port plan, 2007).
- Error tracking hook (Sentry-compatible) wired at the app-factory level, not sprinkled ad hoc.

## 5. Testing strategy

- Backend: unit tests for services/schemas, API tests (FastAPI TestClient) for every route incl.
  auth/permission failure cases, DB tests against a throwaway test schema/container.
- Frontend: component tests for the Try-On Studio state machine steps, a basic end-to-end happy-path
  test (upload → select → result).
- AI: deterministic unit tests for the geometry engine's math (given known landmark coordinates,
  scale/rotation output must match expected values within tolerance) — this is the one place
  "AI testing" is actually just normal deterministic unit testing, which is a benefit of the
  geometry-first MVP choice.
- Evaluation harness (separate from CI unit tests): batch-runs the `evaluation/` dataset and reports
  placement accuracy / scale error / landmark error / failure rate as tracked metrics over time, not
  a one-off manual check.

## 6. Major risks (ranked)

1. **Ear/wrist/finger visibility in real-world photos** (hair covering ears, sleeves covering
   wrists, poor lighting) — mitigated by front-end capture guidance and pre-flight landmark-
   confidence checks that ask the user to retake the photo rather than silently producing a bad
   result.
2. **Realism ceiling of pure compositing** without a working shadow/lighting model — mitigated by
   treating shadow synthesis as a first-class Milestone 6 workstream, not an afterthought, and by
   being explicit with the user in-product that this is "best achievable realism," never "100%
   realistic" (per the spec's own instruction).
3. **Licensing drift** — a well-meaning contributor pulling in a convenient CC-BY-NC checkpoint later
   without re-checking terms. Mitigation: a `models/LICENSES.md` registry checked in CI (fails build
   if an unregistered model path is referenced).
4. **Scope creep into generative AI too early**, re-introducing the identity-preservation problem the
   whole architecture is designed to avoid. Mitigation: this document and `ai-research.md` are the
   standing rationale; any future generative addition must go through the evaluation harness and be
   compared against the geometry baseline before shipping (Milestone 5 gate, explicit in spec).

## 7. Missing requirements discovered (not in original spec, added here)

- **Guest vs. authenticated try-on sessions** — the spec didn't say whether login is required to try
  jewellery on; recommend guest-allowed for MVP (lower funnel friction for an e-commerce-adjacent
  product), with optional account creation to save results/favorites.
- **Photo capture UX guardrails** (framing guide, "remove hair from ears" style hints, retry flow on
  low landmark confidence) — without this, the placement-accuracy risk above becomes a support/
  trust problem, not just an engineering one.
- **EXIF/GPS stripping on ingest** — a privacy requirement not explicitly stated but necessary given
  photos are user-identifiable.
- **Content moderation on uploaded photos** — minimal but necessary: reject obviously non-person
  images before spending processing time, and have a policy for inappropriate uploads (even for an
  internal tool, this is a production-readiness gap otherwise).
- **A `models/LICENSES.md` registry** (see risk #3) so every model dependency's license is checked
  in, versioned, and CI-checkable — operationalizes the spec's "flag unclear commercial licensing"
  rule instead of leaving it as a one-time judgment call.
- **Rate limiting / abuse budget specifically for future generative-AI calls**, since those have a
  real per-call dollar cost unlike the CPU-only geometry engine.
