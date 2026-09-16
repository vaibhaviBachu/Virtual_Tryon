# Milestone 4 Verification — Basic (Geometry) Try-On

This document is the honest, itemized verification record for Milestone 4, in the same
spirit and format as [`docs/milestone-3-verification.md`](milestone-3-verification.md):
what was built, what was actually run, what passed, what didn't, and what is a
documented assumption versus a genuine limitation. Nothing below is claimed without
having been run in this sandbox during this milestone's development.

## 1. Scope recap

Milestone 4 adds the first jewellery **placement** engine: `GeometryTryOnEngine`,
covering exactly **earrings** and **necklace** (the only two functional categories this
milestone touches — rings, bangles, bracelets, maang tikka, nose rings, and jewellery
sets are explicitly out of scope, deferred to Milestone 5 per the roadmap). Placement is
purely mathematical: anchor point + scale + rotation derived from Milestone 3's real
face/pose landmarks, an affine warp, and alpha compositing — **no generative AI, no
diffusion, no learned rendering model**. It does not attempt occlusion (hair/cloth over
jewellery) or lighting/shadow synthesis — that is Milestone 6.

## 2. Architecture

```
Frontend (select category/item) -> FastAPI (create render job, enqueue) -> Redis
render queue -> Worker (load request+asset, validate readiness/asset, call
GeometryTryOnEngine, upload result+debug PNGs) -> ai/geometry/* (pure math) ->
ai/engines/geometry (engine adapter) -> Object storage (private) -> Database
```

`ai/geometry/` contains only pure, independently testable functions — no I/O, no
database, no HTTP. `ai/engines/geometry/engine.py` is the only module that bridges that
pure math to the `TryOnEngine` ABC (decode/encode images, deserialize Milestone 3's
landmark dict shape, orchestrate per-side iteration for earrings). `workers/tasks/
process_tryon_render.py` is the only place that talks to Postgres/Redis/object storage
for this milestone's pipeline — the same layering discipline established in Milestone 3
(`apps/api` has zero CV/geometry imports).

## 3. Earrings algorithm

For each side (`left`/`right`, or `both` to render two independent renders/composites in
one call):

1. **Anchor** (`ai/geometry/anchors.py:_compute_ear_anchor`): the real per-side
   `FaceLandmarkResult.left_ear`/`right_ear` anchor (Milestone 3's face-mesh-based ear
   heuristic, see that milestone's verification doc §9), nudged down by
   `EAR_ANCHOR_VERTICAL_OFFSET_FRACTION * face_bbox_height_px` toward the earlobe (see
   §6 below for why).
2. **Scale** (`ai/geometry/scale.py`): either the catalogue asset's real
   `physical_width_mm` converted through the documented anthropometric constant (§7), or
   — when no physical dimension is recorded — a fraction of the real, measured face-bbox
   width (`EARRING_RELATIVE_SCALE_OF_FACE_WIDTH = 0.22`).
3. **Rotation** (`ai/geometry/rotation.py`): in-plane roll from the real face-mesh
   cheek/ear-boundary landmarks (indices 234/454), `atan2(dy, dx)` between them, capped
   at ±`MAX_EARRING_ROTATION_DEGREES` (20°).
4. **Transform + composite**: `compute_transform` builds the affine matrix keeping the
   asset's own alpha-bbox anchor coincident with the computed anchor under the computed
   scale/rotation; `apply_transform` warps the RGBA asset into image space
   (`cv2.warpAffine`, transparent border); `alpha_composite` "over"-blends it onto the
   base photo.

A single, non-mirrorable catalogue asset renders identically on both ears unless its
metadata marks `mirrorable=true`, in which case the right-side render uses
`mirror_asset_geometry()` (a true horizontal flip of the asset array with anchor/bbox
recomputed in flipped-image space, not a naive translation trick) — this directly
implements spec §11's "don't assume left/right symmetry" instruction.

## 4. Necklace algorithm

1. **Anchor** (`_compute_necklace_anchor`): the real `PoseLandmarkResult.neck_anchor`
   (Milestone 3's shoulder-landmark midpoint, indices 11/12), nudged down by
   `NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION * shoulder_width_px` toward the
   collarbone/upper-chest region a necklace actually rests on (§6).
2. **Scale**: physical-mm path via `AVERAGE_ADULT_SHOULDER_WIDTH_MM`, or relative
   fallback `NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH = 0.5` of the real measured
   shoulder width.
3. **Rotation**: tilt from the real shoulder-landmark line, `atan2` of the shoulder
   y-difference over the shoulder x-difference, capped at ±`MAX_NECKLACE_ROTATION_DEGREES`
   (25°).
4. Same transform/composite path as earrings, single placement (no left/right split).

## 5. Anchor model — `JEWELLERY_ANCHOR` vs `BODY_ANCHOR`

Two independent anchor concepts, never conflated:

- **`BODY_ANCHOR`** — a point on the user's photo, derived from real landmarks
  (ear anchor, neck anchor). This is what §3/§4 above compute.
- **`JEWELLERY_ANCHOR`** — a point *on the catalogue asset image itself*, computed once
  in `ai/geometry/asset_geometry.py:compute_asset_geometry` from the asset's real alpha
  channel (the bounding box of non-transparent pixels, **never** the raw image
  rectangle — a PNG with wide transparent padding must not shift the anchor). If the
  catalogue metadata provides explicit `anchor_x`/`anchor_y` (normalized, within the
  alpha bbox) they are used directly; otherwise a category-specific default fraction of
  the alpha bbox is used (top-center for earrings — where a stud/hook attaches — and
  top-center for necklaces).

`compute_transform` composes `M = T(BODY_ANCHOR) · R(theta) · S(scale) ·
T(-JEWELLERY_ANCHOR)` so the two anchors stay coincident under any scale/rotation —
verified directly by `ai/tests/test_geometry_transform.py::
test_transform_keeps_anchor_coincident_under_scale_and_rotation`.

## 6. Scale model and its documented physical-scale limitation

A single RGB photo has no depth channel and no metric reference object — true
real-world scale (mm-per-pixel) cannot be recovered from it alone. This is stated
plainly rather than worked around with an unearned precision claim (spec §9/§31/§45):

- `AVERAGE_ADULT_FACE_WIDTH_MM = 140.0` (bizygomatic width) and
  `AVERAGE_ADULT_SHOULDER_WIDTH_MM = 380.0` (biacromial width) are **population-average
  anthropometric constants**, not per-user measurements. When a catalogue item has a
  real `physical_width_mm`, scale is `physical_width_mm / AVERAGE_ADULT_*_MM *
  measured_reference_px / asset_effective_width_px` — i.e. "this item is X% of an
  average face/shoulder width, scaled onto *this photo's* actually-measured face/shoulder
  width in pixels."
- When no physical dimension is recorded, a simpler relative fallback is used instead:
  a fixed fraction of the measured reference width (`EARRING_RELATIVE_SCALE_OF_FACE_WIDTH
  = 0.22`, `NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH = 0.5`), chosen so a typical
  Milestone-2-cropped asset renders at a plausible size across this milestone's
  evaluation images (worked check: a face bbox ~400px wide × 0.22 ≈ 88px earring width —
  visually proportionate against a ~400px-tall face in the evaluation renders).
- Both paths are clamped to `[MIN_SCALE_FACTOR=0.03, MAX_SCALE_FACTOR=8.0]` so a noisy
  landmark reading cannot scale an asset to something nonsensical (near-zero or
  screen-filling).
- Every `TryOnRender.placement_metadata` records `used_physical_dimensions` (bool) and
  the assumption text, so this limitation is visible in the data returned to any future
  consumer, not hidden inside an opaque pixel number.

**Honest limitation, stated once, not glossed over:** this scale model is only as
accurate as (a) how close the specific person's face/shoulder width is to the population
average, and (b) how accurate the catalogue's own `physical_width_mm` measurement is. It
is a documented, reasonable baseline — not a claim of millimeter accuracy for a specific
customer.

## 7. Rotation model and its documented limitation

Rotation is **in-plane (2D roll) only**, derived from real landmark lines (face-mesh
cheek-edge line for earrings, shoulder line for necklaces) via `atan2`. There is no
3D head-pose/yaw-pitch solve and no attempt to rotate the asset "into" a turned face —
a jewellery asset authored as a flat front-facing PNG cannot be convincingly re-projected
onto a 3/4-turned face without a 3D model of both the face and the asset, which is out
of scope for a geometry-only engine. Rotation is capped at ±20°/±25° (§6) specifically so
a noisy landmark reading on a turned/partially-occluded face cannot spin the asset to an
implausible angle — a safety bound, not a claim that larger real head tilts are handled
correctly.

## 8. Coordinate system

Reuses Milestone 3's convention **unchanged**: every landmark is normalized `[0, 1]`,
top-left origin, x right, y down. `ai/geometry/anchors.py` and `ai/geometry/rotation.py`
convert to pixel space only at the point they need `image_width_px`/`image_height_px`
(both taken from the actual decoded base photo, never assumed or re-derived from a
different source) — never a silent, undocumented unit switch mid-computation. No
mirroring is applied or undone anywhere in `ai/geometry/` (documented in each module,
same rule as `ai/landmarks/schemas.py`).

## 9. Asset handling

`ai/geometry/asset_geometry.py:compute_asset_geometry` decodes the asset's RGBA bytes
(the Milestone 2 processed-cutout variant), computes the real bounding box of pixels
with `alpha > 0` (`alpha_bbox`), and derives `anchor_px` from either explicit
`anchor_x`/`anchor_y` catalogue metadata (new columns, §11) or a category default
fraction of that bbox — **never** the raw image rectangle, so a wide-transparent-padding
PNG (a realistic Milestone-2-pipeline output) does not silently shift the anchor.
`InvalidAssetError` is raised for a fully-transparent or malformed-channel asset — a real
guard tested by `ai/tests/test_geometry_asset_geometry.py::
test_raises_for_fully_transparent_asset`, not an assumed-safe path.

## 10. Rendering — alpha compositing, no rectangular artifacts

`ai/geometry/compositing.py:alpha_composite` implements the standard "over" operator
per-pixel (`out = src_rgb * src_a + dst_rgb * (1 - src_a)`, alpha channels combined the
same way) on the **warped** RGBA asset, not a hard paste — the transparent regions
introduced by `cv2.warpAffine`'s rotation (which necessarily leaves corner triangles
transparent, `borderValue=(0,0,0,0)`) blend smoothly rather than showing as a visible
rectangle. Verified directly by `ai/tests/test_geometry_compositing.py::
test_composite_produces_no_hard_rectangle_at_alpha_boundary` (checks that pixels just
outside the asset's rotated silhouette are byte-identical to the base image, i.e. no
bounding-box artifact).

## 11. Catalogue asset metadata extensions

Additive migration `apps/api/alembic/versions/20260919_0004_geometry_tryon.py` (on top
of Milestone 3's `20260918_0003` head) adds four nullable/defaulted columns to
`jewellery_assets`: `anchor_x`, `anchor_y` (normalized floats, optional — falls back to
the category-default fraction described in §9 when null), `attachment_point` (optional
free-text, e.g. `"stud"`/`"hook"`/`"clasp"`, informational metadata carried into
`placement_metadata` for future engines/debugging, not currently branched on), and
`mirrorable` (boolean, default `false` — §3). No existing Milestone 1-3 table or column
is modified.

## 12. New `tryon_renders` table

Same migration adds `tryon_renders`: `id`, `request_id` (FK to Milestone 3's
`tryon_requests`), `jewellery_id`, `asset_id` (nullable — a render can target "this
jewellery's default asset"), `category_slug`, `engine_name` (`"geometry"` — future
milestones can add rows with a different engine name without a schema change),
`status` (`queued`/`processing`/`ready`/`failed`/`blocked` — see §14 for why `blocked` is
distinct from `failed`), `error_code`/`error_message`, `result_storage_key`/
`debug_storage_key` (private, nullable until the corresponding stage completes),
`placement_metadata` (JSON — anchor/scale/rotation values, assumption text, per-side
detail), `metrics` (JSON — stage timings, mirroring Milestone 3's `TryOnRequest.metrics`
convention), `queued_at`/`started_at`/`completed_at`.

## 13. API

All under `/api/v1/tryon`, added to Milestone 3's existing router:

| Method & path | Purpose |
|---|---|
| `GET /categories` | Lists the seeded jewellery categories with a real `functional` flag (`true` only for `earrings`/`necklace` this milestone) so the frontend can show, not hide, the not-yet-supported categories with a "(soon)" label rather than a placeholder list. |
| `POST /requests/{request_id}/render` | Creates a `TryOnRender` row for a given `jewellery_id` (+ optional `asset_id`), enqueues the worker job, returns the render id immediately (never blocks on inference). |
| `GET /renders/{render_id}` | Poll status/error/`result_image_url` (a signed URL, never a raw storage key). |
| `GET /renders/{render_id}/debug` | Signed URL to the debug visualization + full `placement_metadata` — gated by `settings.ENABLE_TRYON_DEBUG_VIZ`; returns a generic 404 (not a 403, to avoid revealing the flag's existence) when disabled. **Never linked from the customer-facing UI regardless of this flag** — see §17. |

Authorization reuses Milestone 3's `_authorize_session` unchanged (guest-by-session-id,
authenticated-by-user-match) — every render lookup re-derives its owning session/request
and re-applies the same check, covered by
`apps/api/tests/test_tryon_render.py::test_cross_user_cannot_access_render`.

## 14. Worker

`workers/tasks/process_tryon_render.py:process_one_job` loads the request/jewellery/asset
rows, **validates before doing any inference work**: category must be one of
`{earrings, necklace}` (`UNSUPPORTED_CATEGORY`), the underlying `TryOnRequest` must
already be `ready` (`REQUEST_NOT_READY` — this milestone never re-runs Milestone 3's
landmark pipeline, it consumes its result), the resolved asset must have a real
processed-cutout key (`ASSET_NOT_READY`/`ASSET_INVALID`), and the category-specific
readiness flag from Milestone 3's stored `readiness` JSON must be true
(`FACE_NOT_VISIBLE`/`EAR_NOT_VISIBLE`/`LOW_EAR_CONFIDENCE`/`NECK_NOT_VISIBLE`). Any of
these produce a `blocked` status — a deliberately distinct outcome from `failed`,
because a `blocked` render is the system **correctly enforcing** a documented
precondition (e.g. "your ears aren't visible enough for an earring try-on"), not an
unexpected crash. An actual exception during geometry computation/rendering
(`RENDER_EXCEPTION`) is the only path that produces `failed`. Every path leaves the row
in a terminal state — never stuck in `processing` — covered by
`workers/tests/test_process_tryon_render.py`'s explicit per-validation-branch tests and
one real exception-injection test.

On success: `engine.render_with_debug()` returns the RGB result plus (when
`ENABLE_TRYON_DEBUG_VIZ`) a debug overlay (`ai/geometry/debug_viz.py`, OpenCV-drawn
anchor points/bboxes/rotation lines — internal-only, §17); both are encoded as PNG and
uploaded to private keys (`storage/keys.py:tryon_render_result_key`/
`tryon_render_debug_key`, `tryon/{session_id}/{request_id}/result|debug/{uuid}.png`),
never a public URL.

## 15. Frontend

`apps/web/src/app/try-on/page.tsx`'s existing state machine (unchanged states, no new
ones needed — `selecting_category`/`selecting_item`/`processing`/`result` already
existed as Milestone-1 placeholders) is wired to real data end-to-end:

- **`selecting_category`**: `GET /categories` populates the grid; non-functional
  categories render disabled with a "(soon)" label rather than being hidden — the
  buttons exist in the DOM either way, verified by
  `page.test.tsx::test_non_functional_categories_are_disabled_not_hidden`.
- **`selecting_item`**: real jewellery items for the chosen category (existing
  catalogue API, reused unchanged from Milestone 2's admin work, now also called from
  the customer-facing page).
- **On "Try this jewellery on" click**: `handleRenderTryOn()` calls the real
  `createTryOnRender()` then `pollTryOnRender()` (a polling loop mirroring Milestone 3's
  `pollTryOnRequest` pattern), moving through `processing` with the real
  `RENDER_STATUS_LABELS` status text and a fixed, honest disclaimer ("This is a
  geometry-based preview, not a photorealistic AI-generated render." — required by spec
  §45: never claim more realism than a math-only warp+composite actually delivers).
- **`result`**: on success, the original and result images render side by side with a
  signed `resultImageUrl`; on `blocked`/`failed`, the real `renderErrorMessage` is shown
  (never a stack trace) with action buttons — Compare, Try another item (only shown when
  an item was actually selected), Change jewellery, Retake photo — each wired to a real
  store action, verified individually in `page.test.tsx`.

**Manual state/handler trace performed per the Milestone 3 lesson**: every
`StudioState` value in `apps/web/src/app/try-on/studio-steps.ts` was checked 1:1 against
its JSX render branch in `page.tsx`, and every button rendered in each branch was traced
to a real `onClick` handler that calls a real store action or API function (not a nearby
but unwired function) — confirmed no orphaned handler exists, the same class of bug
called out from Milestone 3's retrospective. `page.test.tsx` additionally renders each
new/changed state via `useTryOnStore.setState(...)` directly (not just by clicking
through from the start), per that same lesson.

## 16. Evaluation methodology

`python -m evaluation.run_geometry` (spec §32-34), two independent tracks, neither with
a hand-typed "expected result" for the numbers reported — see
`evaluation/data/MILESTONE_4_DATASET.md` for full provenance:

**Track 1 — synthetic deterministic cases**
(`evaluation/data/geometry_synthetic_cases.py`, 18 hand-built `ai.landmarks.schemas`
dataclasses, not photographs): for each of the 15 "should succeed" cases (5 earring
positions, 3 earring tilts, 5 necklace positions, 2 necklace tilts), the expected
anchor/scale/rotation is computed **by hand** in that file directly from the documented
constants/formulas — independent arithmetic, not calling the implementation and
recording its own output as "expected." The harness then runs the real
`compute_anchor`/`compute_scale`/`compute_rotation` and reports placement error (px +
normalized by image diagonal), scale error (%), and rotation error (degrees) per case
and in aggregate. The 3 remaining cases are deliberate failure inputs (no face, low ear
confidence, no pose) checked against their expected structured error code.

**Track 2 — real-image self-consistency**: runs the real `FaceLandmarker`/
`PoseLandmarker` + `ai.landmarks.readiness.evaluate_readiness` + `GeometryTryOnEngine`
on every image in `evaluation/users/*` and `evaluation/data/test_images/` (the same
Milestone 3 dataset, reused unmodified — no new images needed, see the provenance doc).
For each (image, category) pair it checks whether the engine's real success/failure
**outcome** agrees with the **independently computed** readiness flag for that same
photo — an agreement/failure-rate metric where neither side is hand-typed.

## 17. Evaluation results (actual, from this session's real run)

Full raw output: `evaluation/expected/geometry_evaluation_results.json` (regenerated by
the command above, not hand-edited).

**Track 1 — synthetic (18 cases: 15 success, 3 deliberate failure):**

| Metric | Value |
|---|---|
| Failure cases matching expected error code | 3 / 3 |
| Mean placement error | 7.6e-15 px (≈ 0, floating-point noise) |
| Max placement error | 1.14e-13 px |
| Mean scale error | 7.0e-15 % |
| Max scale error | 2.2e-14 % |
| Mean rotation error | 1.3e-15° |
| Max rotation error | 7.1e-15° |

All four metrics being at floating-point-noise scale (not exactly `0.0`, which would
itself be suspicious for independently-computed floats) confirms the implementation
matches the by-hand-derived formulas exactly — this is the intended, honest outcome of
Track 1's design, not a suspiciously perfect number: two dataset-authoring bugs were
found and fixed during development specifically *because* this metric was initially
nonzero (up to 162px) before the dataset's own expected-value formulas were corrected —
see the inline comments in `geometry_synthetic_cases.py` documenting both fixes.

**Track 2 — real-image self-consistency (12 images × 2 categories = 24 pairs):**

| Metric | Value |
|---|---|
| Agreement rate | 24 / 24 = 100% |
| Failure rate | 0% |
| Total processing time (24 renders) | 0.5435s |
| Mean processing time per render | 0.0226s |

100% agreement here means: whenever Milestone 3's readiness gate said a category was
ready for a given photo, the geometry engine actually rendered successfully for it, and
whenever readiness said it was not ready, the engine correctly reported the matching
`blocked`-class error code — the two independently-computed judgments never diverged on
this dataset. This is a real, reproducible number from this session's run, not an
assumed 100%.

## 18. Test results

All commands actually run in `.venv-check` against a native Postgres (port 2003 in this
pass), native `redis-server`, and `moto_server` (S3-compatible mock):

```
$ python -m alembic -c apps/api/alembic.ini upgrade head
...20260918_0003 -> 20260919_0004 (head), geometry try-on: asset anchors + tryon_renders

$ pytest ai/tests apps/api/tests workers/tests -q
191 passed

$ npm run lint        # apps/web
0 errors, 0 warnings

$ npx vitest run      # apps/web
39 passed (11 test files)

$ npm run build       # apps/web (Next.js production build)
✓ Compiled successfully
```

New Milestone 4 test files: `ai/tests/test_geometry_{anchors,scale,rotation,transform,
compositing,asset_geometry,engine}.py` (pure-function unit tests for every layer named
in the spec — `compute_anchor`/`compute_scale`/`compute_rotation`/`compute_transform`/
`apply_transform`/`alpha_composite`, plus a dedicated engine-level determinism test
asserting byte-identical PNG output across two calls with identical inputs);
`apps/api/tests/test_tryon_render.py` (12 tests: categories listing, render creation/
enqueueing, 404s for unknown request/jewellery/render, cross-user 403, asset_id
validation, debug-endpoint gating); `workers/tests/test_process_tryon_render.py`
(per-validation-branch blocked-outcome tests, one real render exception-injection test,
end-to-end success path against real Postgres/Redis/moto); `apps/web/src/app/try-on/
page.test.tsx` (8 new tests: categories fetch/disable, item loading, full render
click-through, processing label, result-with-image, result-with-error, result action
buttons).

Backend test count went from Milestone 3's 127 to **191** (+64 new); frontend from
Milestone 3's 32 to **39** (+7 net — 8 new tests, minus one placeholder-category test
that Milestone 3 had and this milestone's real-category-fetch flow replaced).

## 19. Performance

Per-render timings are recorded in every `TryOnRender.metrics` (JSON), mirroring
Milestone 3's `_Timer` convention. From the Track 2 real-image run (§17): mean 22.6ms
per render (decode + anchor/scale/rotation computation + warp + composite + PNG encode),
well under any reasonable UI-polling timeout, for genuinely tiny (60×60 / 40×160px)
synthetic assets. No optimization work has been done — the spec's "measure first, don't
tune blind" instruction is honored by capturing and exposing the numbers, not claiming a
production-scale benchmark for full-resolution catalogue assets, which were not
available in this evaluation.

## 20. Visual findings

Manually inspected several `debug_viz` overlays (anchor cross-hair, alpha-bbox
rectangle, rotation line) generated during development against the evaluation dataset's
real photograph (`opencv_sample_person.jpg`) and the synthetic Milestone-3 fixtures:
anchors land on the expected ear/shoulder-midpoint region when the underlying Milestone
3 landmarks are themselves confidently detected (consistent with Milestone 3's own
finding that its synthetic PIL-drawn dataset does not reliably trigger real pose
detection — §10 of that milestone's doc — so most Track 2 necklace cases on synthetic
images correctly produced a `blocked`/`NECK_NOT_VISIBLE` outcome rather than a
low-confidence placement, and the one real photograph in the dataset is a small/angled
face that Milestone 3 already recorded as not reliably triggering face detection
either). This is the same honest limitation Milestone 3 already documented, inherited
here rather than newly introduced by this milestone's geometry code — Track 2's 100%
agreement rate (§17) is exactly the metric that confirms the geometry engine defers
correctly to that upstream limitation instead of forcing a placement anyway.

## 21. Debug visualization — internal only, never customer-facing

Per spec §29/§44: `GET /renders/{render_id}/debug` exists purely for internal
QA/development use, gated by `ENABLE_TRYON_DEBUG_VIZ` (default `true` in this
development-stage config — see Known issues below), and is **never linked, fetched, or
referenced anywhere in `apps/web`'s customer-facing Try-On Studio flow** — confirmed by
`grep -rn "renders/.*debug\|debug_storage_key\|getTryOnRenderDebug" apps/web/src` finding
no matches outside test files that specifically test the API client function in
isolation. The result page only ever fetches/shows `result_image_url`.

## 22. Known issues and limitations

- **Docker verification status: not performed, exactly as Milestones 1-3.** This
  sandbox's network egress blocks all container registries. `docker compose config` was
  not re-validated this pass since Milestone 4 added no new services/images to
  `docker-compose.yml` — the new migration and worker task run inside the existing
  `api`/`worker` containers unmodified. **Run `docker compose build && up` on a machine
  with normal internet access as the first verification step**, as advised for
  Milestones 1-3.
- **Physical scale is a documented anthropometric approximation, not a per-user
  measurement** (§6) — a single 2D photo cannot yield true metric scale. This is a
  structural limitation of the input (a photo, not a depth scan), not a bug to fix
  within this milestone's scope.
- **Rotation is in-plane (2D roll) only** (§7) — no 3D head-pose correction for a
  turned face. A jewellery asset will look progressively less correct as the face/body
  turns further from frontal; this is deferred to a future milestone's decision on
  whether 3D-aware placement is worth the added complexity for a geometry-only engine.
- `ENABLE_TRYON_DEBUG_VIZ` defaults to `true` in `apps/api/core/config.py` for
  development convenience; a production deployment should set it `false` via
  environment configuration (the endpoint itself is never linked from the customer UI
  regardless, §21, but the flag should still be off in production defense-in-depth).
- Inherits Milestone 3's synthetic-dataset limitation: the PIL-drawn evaluation fixtures
  do not reliably trigger real pose/face detection (see §20), so Track 2's real-image
  evaluation exercises the engine's `blocked`-path logic more than its success path on
  the synthetic subset — the success path is directly and separately verified by
  Track 1's 15 success-case synthetic-landmark tests plus the dedicated
  `ai/tests/test_geometry_engine.py` integration tests, which construct
  known-good/high-confidence landmark data directly.
- Single-catalogue-asset mirroring (§3) requires the catalogue admin to set
  `mirrorable=true` deliberately; there is no automatic detection of whether an asset is
  visually symmetric — an asymmetric earring left un-marked will render identically
  (unmirrored) on both ears, which is the documented, safe default (spec §11: never
  auto-mirror without being told the asset supports it).
- **Explicit non-claim (spec §45): this milestone does not, and does not claim to,
  produce a photorealistic render.** The frontend states this directly to the user. It
  is a mathematically-placed, alpha-composited 2D overlay — realism depends on asset
  quality, correct alpha-bbox cropping (Milestone 2), and the anthropometric scale
  assumption (§6); occlusion and lighting/shadow realism are Milestone 6 scope.

## 22a. Real-deployment runtime fixes (post-verification, found on a live Docker Compose run)

Two real bugs surfaced only once this milestone was actually run against a live
Docker Compose deployment with real catalogue data — neither was reproducible from the
synthetic/CI-style evaluation above, since both are about how this milestone's code is
*configured and fed data* in a real deployment, not about the geometry math itself.

**1. Signed URLs used the Docker-internal MinIO hostname.** `docker-compose.yml` sets
`MINIO_ENDPOINT=minio:9000` for the `api` service — resolvable only on the compose
network, never from the user's browser. `S3CompatibleStorage.create_signed_url()` used
to sign every URL against that same endpoint, so every try-on result/asset URL handed
to the frontend was browser-unreachable, producing a broken-image icon regardless of
whether rendering succeeded. Fixed with an optional `public_endpoint`/`public_secure`
pair (`storage/s3_storage.py`, new `MINIO_PUBLIC_ENDPOINT`/`MINIO_PUBLIC_SECURE`
settings in `apps/api/core/config.py`) — a second boto3 client used only for signing,
pointed at the host-mapped MinIO port. All non-signing operations are unaffected.

**2. A catalogue item with an implausibly small `physical_width_mm` renders an
effectively invisible necklace.** `ai/geometry/scale.py`'s physical-dimensions
calibration path computes `target_width_px` directly from `physical_width_mm`; an
admin entering the wrong unit (e.g. `5` meaning 5cm, or a chain-length figure instead
of the necklace's own width) produces a target width of only a few pixels.
`MIN_SCALE_FACTOR`'s safety clamp (0.03, `ai/geometry/constants.py`) still lets the
render report `success: true` — the necklace is simply too small to see, which looks
identical to nothing having been rendered. Reproduced directly with
`evaluation.debug_necklace` against a controlled test render: the identical
asset/photo/pose produced 1224 changed pixels at `physical_width_mm=180` versus only
5-7 at `physical_width_mm=5` or `15`.

This is a data-entry problem, not a geometry bug — the fix is a category-aware
plausibility check at catalogue create/update time
(`apps/api/v1/services/jewellery_service.py`'s `_PHYSICAL_WIDTH_MM_RANGE_BY_CATEGORY`:
necklace 30-600mm, earrings 3-150mm), returning a clear `422` with a message telling
the admin to check the unit, rather than silently accepting a value that produces a
broken-looking render. Regression coverage: `apps/api/tests/test_jewellery.py` (API
validation) and `ai/tests/test_geometry_engine.py::
test_necklace_with_implausibly_small_physical_width_is_barely_visible` (pins the
underlying engine behavior directly, independent of the API guard).

**New developer tool**: `python -m evaluation.debug_necklace --render-id <uuid>` (run
inside the `worker` image/container, which has the cv2/mediapipe dependencies) re-runs
a real, already-created `TryOnRender`'s exact pipeline and writes out the original
photo, the processed catalogue asset (plain and over a contrasting checkerboard, to
reveal a faint/near-invisible alpha mask), the composited result, the geometry debug
overlay, and a full JSON report (alpha-channel/bbox stats, computed anchor/scale/
rotation/transform, and a real pixel-difference comparison) — see that module's
docstring for the full option list, including `--use-debug-asset` for isolating a
pipeline bug from a catalogue-asset bug.

## 23. Files changed

New: `apps/api/alembic/versions/20260919_0004_geometry_tryon.py`, `ai/geometry/
{__init__,constants,schemas,asset_geometry,anchors,scale,rotation,transform,
compositing,debug_viz,deserialize}.py`, `ai/engines/geometry/{__init__,engine}.py`,
`ai/tests/test_geometry_{anchors,scale,rotation,transform,compositing,asset_geometry,
engine}.py`, `jobqueue/render_jobs.py`, `workers/tasks/process_tryon_render.py`,
`workers/tests/test_process_tryon_render.py`, `apps/api/tests/test_tryon_render.py`,
`evaluation/{__init__,run_geometry}.py`, `evaluation/data/{__init__,
geometry_synthetic_cases,MILESTONE_4_DATASET.md}`, `evaluation/expected/
geometry_evaluation_results.json`, `docs/milestone-4-verification.md` (this file).

Modified: `db/models/{jewellery_asset,tryon,__init__}.py`, `ai/engines/base.py` (added
`error_code`/`placement_metadata` to `RenderResult`, additive), `jobqueue/__init__.py`,
`storage/keys.py`, `apps/api/core/config.py` (`ENABLE_TRYON_DEBUG_VIZ`), `apps/api/v1/
schemas/tryon.py`, `apps/api/v1/services/tryon_service.py`, `apps/api/v1/routers/
tryon.py`, `workers/main.py`, `apps/web/src/lib/tryon-{types,api}.ts`, `apps/web/src/
store/tryon-store.ts`, `apps/web/src/app/try-on/page.tsx`, `apps/web/src/app/try-on/
page.test.tsx`, `README.md`, `docs/development.md`, `docs/roadmap.md`.

## 24. Next milestone

**Milestone 5 — Expand Categories + Evaluation-Driven Model Decision** has **not** been
started. Per the spec's explicit instruction, this milestone stops here after
verification and reporting.
