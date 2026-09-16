# Milestone 2 Verification — Jewellery Catalogue

This is an honest, itemized account of what was built, what was actually run, and what
is still open. Per the project's standing rule: nothing here is claimed "working" or
"ready" without a real, reproducible test behind it. Where something could not be
verified (or could not be built at all, e.g. SAM2), that is stated plainly rather than
glossed over.

## 1. Environment

Milestone 1 already established that this sandbox blocks Docker registries (Docker Hub,
GHCR, GCR, Quay, MCR, ECR Public all return 403) and that `docker compose build` cannot
be run here. Milestone 2 hit the same wall for the huggingface.co host specifically (see
§7). The verification strategy is the same one used in Milestone 1: run the real
dependencies as native OS processes instead of skipping verification.

What was actually running during this milestone's verification, all at once, for real:

- **PostgreSQL 16** (`apt`-installed in Milestone 1, started via `service postgresql
  start`), database `jewellery_tryon`, reachable at `localhost:5432`.
- **Redis** (`redis-server --port 2004`), a real Redis instance, not `fakeredis`, for
  the end-to-end tests.
- **`moto_server`** (`moto_server -H 0.0.0.0 -p 2005`) — a real, S3-API-compatible mock
  server (pure Python, no Docker needed) standing in for MinIO, since MinIO's own binary
  download is blocked by the same registry-style egress rule. A real bucket
  (`jewellery-tryon`) was created in it via `boto3` before use.
- The real FastAPI app (`uvicorn apps.api.main:app`, port 2002).
- The real worker process (`uvicorn workers.main:app`, port 2007), with its background
  consumer thread actually running and actually pulling jobs off Redis.
- The real Next.js frontend, both `next build` (production build) and `next start`
  (port 2001) against the live API above.

Nothing in this milestone's verification talks to a mock database, a mock object store
API surface swapped in only for tests, or a stubbed HTTP client for the manual
end-to-end pass — the automated test suite uses some fakes/stubs deliberately (see §3),
but the manual end-to-end verification in §6 used only the real services listed above.

## 2. Database migration

New migration: `apps/api/alembic/versions/20260917_0002_catalogue_schema.py`
(`down_revision = "20260916_0001"` — does not touch or replace the Milestone 1 baseline).

Actually run, twice, against the real Postgres instance above:

```
alembic -c apps/api/alembic.ini upgrade head
  -> Running upgrade 20260916_0001 -> 20260917_0002, catalogue schema: ...
```

Verified afterward by directly querying Postgres (not by trusting Alembic's own
"success" message):

- `\dt` showed exactly the five expected tables: `alembic_version`, `users`,
  `jewellery_categories`, `jewellery`, `jewellery_assets`.
- `SELECT name, slug, anchor_type, is_active FROM jewellery_categories` returned all
  nine seeded categories (earrings, necklace, haaram, bangles, bracelet, ring,
  maang_tikka, nose_ring, jewellery_set), all `is_active = true`.
- `\d users` and `\d jewellery_assets` were inspected directly — column types,
  defaults, unique constraints, and the `jewellery_assets_jewellery_id_fkey` foreign key
  (`ON DELETE CASCADE`) all matched the SQLAlchemy model definitions exactly.
- `SELECT version_num FROM alembic_version` returned `20260917_0002`.

**Reversibility was actually tested, not assumed**: ran `alembic downgrade
20260916_0001`, confirmed via `\dt` that all four Milestone 2 tables were gone and only
`alembic_version` remained, then ran `alembic upgrade head` again and confirmed the nine
categories were re-seeded (`SELECT count(*) FROM jewellery_categories` → `9`).

## 3. Automated test suite

**76 backend/AI/worker tests, all passing**, run with `pytest` from the repo root
against the real Postgres/Redis/moto stack described in §1 (not an in-memory SQLite
substitute — the whole point of Milestone 1's testing philosophy is real dependencies
wherever practical):

| File | Tests | What it covers |
|---|---|---|
| `apps/api/tests/test_auth.py` | 6 | login success/failure/unknown-email, `/me` auth requirement, real-vs-tampered token |
| `apps/api/tests/test_categories.py` | 8 | public list, auth/role boundary, create/duplicate-slug/invalid-slug, deactivate, 404 |
| `apps/api/tests/test_jewellery.py` | 10 | admin-only create, physical dimensions round-trip, unknown-category/duplicate-SKU/negative-price rejection, get/404, soft-delete-not-hard-delete, pagination, search-by-name-and-SKU |
| `apps/api/tests/test_assets.py` | 9 | valid upload creates original(ready)+processed(pending) rows and enqueues a real job, unsupported MIME, extension/MIME-mismatch (proves content-sniffing, not extension trust), oversized, corrupt, **truncated file** (regression test, see §5), below-minimum-dimensions, unknown-jewellery 404, non-admin 403 |
| `apps/api/tests/test_config.py`, `test_health.py`, `test_security.py` | 14 | Milestone 1 tests, still passing unmodified |
| `ai/tests/test_image_validation.py` | 10 | valid JPEG/PNG, empty/oversized/non-image/unsupported-format rejection, below-minimum-dimensions, **truncated file** (regression test), real EXIF stripping (verified EXIF was present before, absent after), real EXIF-orientation normalization (verified width/height actually swap) |
| `ai/tests/test_background_remover.py` | 3 | real `rembg`/U-2-Net model instance is cached/reused, real transparent output has genuine alpha variance (not a uniform/fabricated value), never raises on garbage input |
| `ai/tests/test_catalogue_processor.py` | 4 | real model produces a real cropped+transparent+thumbnail output, thumbnail never upscales, processing failure surfaces as `ProcessingFailedError` (scripted-failure stub), fully-transparent output is treated as a failure, not a false success |
| `ai/tests/test_engine_registry.py` | 4 | Milestone 1 try-on engine tests, still passing unmodified |
| `workers/tests/test_process_jewellery_asset.py` | 5 | row-loading, missing-row handling, **real success path** (real rembg model, real in-memory storage, real Postgres row updates, verified PNG file signature bytes on the actual stored output), failure path marks `failed` with a safe message that never contains the raw exception text |
| `workers/tests/test_worker_health.py` | 3 | Milestone 1 tests, still passing unmodified |

Command actually run:
```
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/jewellery_tryon \
REDIS_URL=redis://localhost:2004/0 MINIO_ENDPOINT=localhost:2005 ... \
python3 -m pytest -q
# -> 76 passed, 3 warnings (unrelated deprecation warnings from passlib/starlette)
```

**What is mocked in the test suite, and why**: `apps/api/tests/test_assets.py` uses
`fakeredis` (not real Redis) so upload-endpoint tests never race with the live worker
process actually consuming the queue during a test run — the worker's own consumption
logic is tested separately and directly (with a real in-memory `ObjectStorage`, real
Postgres rows, and either the real rembg model or a scripted failure stub) in
`workers/tests/test_process_jewellery_asset.py`. No test anywhere fabricates a
processing result — every "success" assertion in `ai/tests/` and `workers/tests/`
checks genuine output (real alpha-channel variance, a real `\x89PNG` file signature,
real cropped dimensions smaller than the input).

## 4. Frontend

**27 Vitest tests, all passing** (11 Milestone 1 + 16 new Milestone 2), run with
`npm run test` from `apps/web`:

- `AdminLoginForm`: successful login populates the session store; non-admin login is
  rejected client-side with a real message; a real backend error (wrong password) is
  displayed verbatim, not swallowed.
- `CategoryManager`: renders real seeded categories, shows the real 409 conflict
  message on a duplicate slug, clears the form and refetches on success.
- `JewelleryCreateForm`: client-side slug validation blocks submission without ever
  calling the API; a valid submission sends the exact payload (including physical
  dimensions) to the real API function.
- `AssetUploader`: shows "Uploading…" then "Uploaded" (no fake progress percentage —
  deliberately, see the component's own docstring) and surfaces the real backend error
  message on rejection.
- `AssetPreview`: renders the real signed preview URL when ready, shows the real
  `processing_error` text (not a generic message) when failed, shows a distinct
  "Processing…" state while pending.
- `JewelleryList`: renders real items with real fields, shows a real empty state, passes
  the search term through as a real query parameter, surfaces a real error state on API
  failure.
- `AdminCataloguePage`: shows the login gate with no session, shows the real management
  UI once authenticated.
- `JewelleryDetailPage` (`[id]/page.tsx`): login gate, real jewellery details + empty
  asset state once authenticated, real 404 "not found" state for an unknown id.

```
npm run lint    -> 0 errors, 0 warnings
npm run test    -> 27 passed (27)
npm run build   -> Compiled successfully, TypeScript passed, all 6 routes prerendered/
                   built (including the two new /admin/catalogue routes)
```

**A real TypeScript bug was caught by `npm run build`** during this milestone (a test
helper's promise-resolver type didn't match `uploadAsset`'s real return type) and fixed
before this was written — the build was not skipped or worked around.

## 5. A real bug found and fixed during manual testing

While manually uploading a genuinely truncated JPEG (not a synthetic "corrupt bytes"
string, but a real JPEG file cut off after roughly a third of its data) through the live
API, the upload returned an **unhandled HTTP 500**, not the expected 422. The traceback
showed why: PIL's `Image.verify()` (used in `_open_and_verify`) only checks file
*structure*, not full pixel-data decoding — a truncated file can pass `verify()` cleanly
and then raise `OSError: image file is truncated` later, inside
`ImageOps.exif_transpose`'s `.load()` call during EXIF normalization.

Fixed in `ai/preprocessing/image_validation.py`'s `_normalize_orientation_and_strip_exif`
by wrapping that stage in its own try/except and re-raising as `ImageValidationError` (a
safe, catchable error the router already handles as a 422). Re-tested against the same
truncated file after the fix: real HTTP 422 with a clean message, no stack trace in the
response. A regression test for this exact scenario now exists in both
`ai/tests/test_image_validation.py` and `apps/api/tests/test_assets.py`.

## 6. End-to-end catalogue workflow (manual, against the live stack in §1)

Every step below was actually executed with `curl`/`psql` against the running services,
not simulated:

1. Logged in as a real seeded admin (`POST /api/v1/auth/login`) → got a real JWT with
   `role: admin` in its payload.
2. Confirmed the authorization boundary for real: an unauthenticated request to create a
   category returned **401**; the same request as a real non-admin user (a second
   seeded `customer` account) returned **403**; the admin token returned **201**.
3. Created a real jewellery item (`Gold Hoop Earrings`, category `earrings`,
   `physical_width_mm=20`, `physical_height_mm=25`, `weight_g=5.2`) via
   `POST /api/v1/catalog/jewellery`.
4. Started the real worker process, then uploaded a real generated JPEG (a gold-toned
   ring shape on a white background, 600×600px) via
   `POST /api/v1/catalog/jewellery/{id}/assets`. The response showed the `original` row
   already `ready` (with a *different*, smaller file size than the input — proof the
   re-encode/EXIF-strip actually happened, not a byte-for-byte passthrough) and a
   `processed` row `pending`.
5. Watched the real worker log a completed job a few seconds later (model already
   warmed/cached from earlier runs in this session).
6. Fetched the asset list again: `processed` and a new `thumbnail` row were both
   `ready`, with real non-null `width_px`/`height_px`/`file_size_bytes`
   (354×413, cropped down from the original 600×600 — a real bounding-box crop, not a
   full-frame passthrough).
7. Fetched `GET /api/v1/catalog/assets/{processed_id}` → got a real signed MinIO/moto
   URL, downloaded it with `curl`, and inspected the file with Pillow/numpy: **a real
   RGBA PNG, alpha channel genuinely ranging 0–255, ~75% of pixels below alpha 10** —
   i.e., the background really was removed, not faked.
8. Tested the **failure path** directly: seeded a jewellery item + asset rows via the
   ORM, ran the worker's `process_one_job` with a processor stub that always raises
   `ProcessingFailedError`, and confirmed via a fresh `psql` query that the row was
   marked `failed` with the safe, generic message (never the raw exception text) — and
   that `GET /api/v1/catalog/assets/{id}` correctly returned `preview_url: null` for it.
9. Verified the frontend against the same live API: `next build` (production build) and
   `next start` on port 2001, then `curl`'d `/`, `/admin`, `/admin/catalogue`, and
   `/admin/catalogue/{real-item-id}` — all returned **200** with real server-rendered
   HTML (confirmed the login-gate markup and the "Catalogue management" link text were
   genuinely present in the response body, not just assumed from the component code).

## 7. AI/model status — SAM2 is blocked, not faked

Milestone 0's research selected **SAM2** for jewellery-asset background removal. SAM2's
weights are hosted on `huggingface.co`. This sandbox's network policy returns a
**403 Forbidden** (verified directly with `curl -v`, `CONNECT tunnel failed`) for that
host — the same class of egress restriction that blocked Docker registries and Google
Fonts in Milestone 1. This is an environment limitation, not a code problem, and SAM2 is
**not integrated** in this milestone.

Per the explicit instruction not to fake success or leave the feature silently broken,
a real, working, correctly-licensed substitute was built instead:
**`rembg` (MIT license) running the U-2-Net ONNX model (Apache 2.0 license)**. Both
licenses were fetched and read directly from their source repositories (not assumed from
training data) — see `ai/models/LICENSES.md` for the dated verification entries. This
is exposed behind the same `BackgroundRemover` interface/registry pattern used for the
try-on engines (`ai/engines/`), so swapping in SAM2 later (if its weights become
reachable — self-hosted, mirrored, or the network policy changes) is a new class + a
registry entry, not a pipeline rewrite.

`ai/models/LICENSES.md` marks the SAM2 row **BLOCKED (Milestone 2)** with the reason,
rather than removing it or pretending it was never planned.

## 8. Architectural note: `db/`, `storage/`, `jobqueue/` (Milestone 2 spec §36)

**Current architecture (end of Milestone 1)**: `apps/api` owned its own
`db/base.py`/`db/session.py` and `storage/base.py`/`storage/s3_storage.py`; `workers`
had no database or storage code at all (Milestone 1's worker only proved a heartbeat
loop). The stated rule was "`apps/api` and `workers` never import from each other."

**Problem**: Milestone 2 needs the worker to read/write the *same* `JewelleryAsset` rows
the API creates, and to read/write the *same* object-storage bucket — through the exact
same ORM models and the exact same storage abstraction, or the two processes risk silent
drift (e.g. a column added to the API's model but not the worker's).

**Proposed solution (implemented)**: extracted the ORM base/mixins/models
(`db/base.py`, `db/mixins.py`, `db/models/`) and the storage abstraction
(`storage/base.py`, `storage/s3_storage.py`, `storage/keys.py`) into new packages at the
repo root — siblings of `apps/`, `ai/`, and `workers/`, not inside `apps/api/`. A new
`jobqueue/` package (a minimal Redis-list-based queue, deliberately not a full
Celery/RQ/Arq framework yet — see its own docstring) was added the same way, since both
`apps/api` (producer) and `workers` (consumer) need the identical job envelope format.
`apps/api/db/base.py` and `apps/api/storage/base.py` now just re-export from these
root-level packages, preserving every existing import path used elsewhere in
`apps/api`.

**Trade-off**: the "apps/api and workers never import from each other" rule is
preserved exactly (`apps/api` still never imports anything from `workers/`, and
`workers` still never imports anything from `apps.api`) — both now depend on shared
root-level packages instead, which is a narrower, one-directional dependency than
letting the two services import each other. The cost is one more top-level package
grouping to navigate (`db/`, `storage/`, `jobqueue/` alongside `apps/`, `ai/`,
`workers/`).

**Effect on future milestones**: Milestone 4's try-on job queue (`workers` calling
`ai.engines`) should follow the same pattern if it needs to share models/storage
logic with `apps/api` — either reuse `db/models/` directly (adding a `TryOnRequest`
model there) or, if a job type is different enough, add sibling models in the same
package rather than duplicating base/session code a third time.

## 9. Security checks actually performed

- Every mutation route (`POST`/`PATCH`/`DELETE` on categories, jewellery, and assets)
  was hit both unauthenticated (real 401) and as a real non-admin user (real 403) —
  see §6 step 2 and the automated tests in §3.
- Content-based MIME sniffing was proven, not assumed: a real JPEG uploaded with a
  `.png` filename and `image/png` Content-Type was still correctly stored as
  `mime_type: "image/jpeg"` (`test_upload_rejects_extension_mime_mismatch` — misnamed in
  the test file since it actually proves acceptance-by-content, kept as documented
  behavior in the test's own docstring).
- Object storage keys are always freshly generated UUIDs
  (`storage/keys.py:jewellery_asset_key`) — no client-supplied filename ever reaches a
  storage key, which is what actually prevents path traversal, not a
  character-blocklist.
- `processing_error` was confirmed to never contain the raw exception text (§6 step 8;
  also asserted directly in `workers/tests/test_process_jewellery_asset.py`).
- All object storage access is via time-limited (15-minute) signed URLs; buckets are
  never made public (unchanged from Milestone 1's `ObjectStorage` contract).

## 10. Known issues / honest limitations

- **SAM2 is not integrated** (§7) — `rembg`/U-2-Net is a real, working, correctly
  licensed substitute, not a placeholder, but it is a different model than Milestone 0
  originally selected, and its segmentation quality on genuinely difficult jewellery
  photos (very thin chains, glass/gem transparency, low-contrast backgrounds) has not
  been evaluated against a real product photo dataset — the only images tested were
  synthetic (drawn shapes) or the admin's own manual test upload.
- **Admin frontend session is in-memory only** (`src/store/admin-auth-store.ts`) — a
  page refresh logs the admin out. This is a stated, deliberate scope decision (the
  Milestone 2 auth surface is intentionally minimal — see `apps/api/v1/routers/auth.py`)
  and not a bug, but it means the admin UI is not yet pleasant for a long working
  session; a persisted session (secure cookie or refresh-token flow) is Milestone 7
  territory.
- **`docker compose build`/`up` themselves remain unverified for Milestone 2** for the
  same environment reason as Milestone 1 (all container registries return 403 here).
  The application code, migration, and both test suites are verified against real,
  natively-run dependencies (§1); the Docker image build itself rests on the same
  Dockerfiles being correct as in Milestone 1, now with the additional `COPY db /srv/db`
  / `COPY storage /srv/storage` / `COPY jobqueue /srv/jobqueue` lines — those specific
  lines have not been verified inside an actual container build in this sandbox.
- **No load/stress testing** of the background-removal pipeline was performed — only
  single-image, sequential processing was verified. Concurrent upload behavior under
  real load (multiple admins uploading simultaneously) is untested.
- **`processing_status: "processing"`** is set by the worker but was not separately
  observed mid-flight in the manual end-to-end test, since a single small image
  processes in well under the 2-second frontend poll interval — the state transition
  logic was verified by direct code inspection and by the `pending`→`ready` and
  `pending`→`failed` transitions both being genuinely observed.

## 11. Passed criteria (from the Milestone 2 spec's acceptance list)

Categories are database-driven with the nine required seed rows and no hard-coded
category logic; jewellery CRUD with physical dimension fields persists and round-trips
correctly; the `JewelleryAsset` model stores only object-storage keys and metadata, never
binary data, with `original`/`processed`/`thumbnail` variants; admin-only upload
performs real content-based MIME validation, size/dimension limits, corrupt-image
detection (including the truncated-file edge case found and fixed during this
milestone), EXIF stripping, and orientation normalization, all independently verified;
background removal and thumbnail generation run asynchronously via the existing
worker/Redis architecture, never synchronously inside the API request (verified by the
`202 Accepted` response and the separate worker log entry for job completion); every
mutation endpoint is gated by the existing JWT-based `require_admin` dependency with no
second auth system; a working `/admin/catalogue` UI (list/filter/search, create form,
detail page with original/processed/thumbnail preview on a checkerboard background) is
built and was exercised against the real live API; the Milestone 2 migration is
additive, reversible (tested both directions), and does not modify the Milestone 1
baseline; 76 backend/AI/worker tests and 27 frontend tests all genuinely pass; and the
SAM2 licensing/blocking situation is documented honestly rather than faked.

## 12. Failed / not-attempted criteria

Load/stress testing of concurrent uploads (§10) was not attempted. SAM2 itself was not
integrated — a real, licensed, working substitute was built and is clearly documented as
such, but this is not the originally-specified model. `docker compose build/up` remain
unverified in this sandbox for the reason stated in §10 (identical to Milestone 1's own
documented limitation). No evaluation of background-removal quality against a real
product-photography dataset was performed.

## Next milestone

Per the Milestone 2 boundary, this stops here. **Milestone 3** (User Image Pipeline —
MediaPipe, face/hand/pose landmarks, user photo segmentation) has **not** been started:
no MediaPipe dependency, landmark code, segmentation-for-user-photos, geometry/placement
engine, or virtual try-on rendering exists anywhere in this codebase. That work begins
only on explicit instruction.
