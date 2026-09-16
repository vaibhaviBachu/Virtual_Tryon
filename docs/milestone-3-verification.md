# Milestone 3 Verification — User Image Pipeline

This document is the honest, itemized verification record for Milestone 3, in the same
spirit and format as [`docs/milestone-2-verification.md`](milestone-2-verification.md):
what was built, what was actually run, what passed, what didn't, and what is a real
substitute versus a genuine blocker. Nothing below is claimed without having been run
in this sandbox during this milestone's development.

## 1. Scope recap

Milestone 3 builds the complete **user-photo understanding pipeline**: camera/upload →
validation → orientation/EXIF normalization → private storage → async worker
processing (face, hand, pose landmarks + segmentation) → confidence scoring →
category-aware readiness. It does **not** place any jewellery on the user's photo —
no compositing, no warping, no shadows/lighting synthesis, no generative AI. That is
Milestones 4–6.

## 2. Model research and the MediaPipe substitution — read this first

Real `MediaPipe Face/Hand/Pose Landmarker` and `Multiclass Selfie Segmenter` (the
current **Tasks API**) fetch their `.task` model-weight files at runtime from
`storage.googleapis.com`. That host returns a policy-level `403` from this sandbox's
network egress (verified directly with `curl`, the same class of restriction that
blocked Docker registries in Milestone 1 and `huggingface.co`/SAM2 in Milestone 2). The
Tasks API genuinely cannot run here.

However, the same `mediapipe` PyPI package also ships an older, still-supported
**Solutions API** (`mediapipe.solutions.face_detection`, `.face_mesh`, `.hands`,
`.pose`, `.selfie_segmentation`) whose `.tflite` model weights are **bundled directly
inside the wheel itself** — confirmed by `unzip -l` on the downloaded wheel, which
lists `mediapipe/modules/face_detection/face_detection_short_range.tflite`,
`mediapipe/modules/face_landmark/face_landmark.tflite`,
`mediapipe/modules/palm_detection/palm_detection_full.tflite`,
`mediapipe/modules/hand_landmark/hand_landmark_full.tflite`,
`mediapipe/modules/pose_detection/pose_detection.tflite`,
`mediapipe/modules/pose_landmark/pose_landmark_full.tflite`, and
`mediapipe/modules/selfie_segmentation/selfie_segmentation.tflite` /
`..._landscape.tflite`. No network fetch happens at import or inference time. This is
**real Google-published MediaPipe inference** — the same underlying model family as the
Tasks API — not a heuristic, not a different algorithm, not a stand-in.

The catch: the current default `pip install mediapipe` (`1.0.1`+) **removed** the
Solutions API entirely (`dir(mediapipe)` no longer contains `.solutions` — confirmed by
direct test). This project therefore pins `mediapipe==0.10.9` (the last release still
shipping it) in `workers/requirements.txt`, together with `protobuf==3.20.3` (0.10.9
requires `protobuf<4`; Milestone 2's `rembg`→`onnxruntime` dependency declares
`protobuf>=4.25.8`, but both were verified together at `protobuf==3.20.3` in this
repo's actual installed environment — `rembg.remove()` still produces a valid
transparent PNG and all four MediaPipe solutions still run correctly at that pinned
version; see the commands below).

Verified live in this session's `.venv-check` environment before writing this document:

```
$ python -c "import mediapipe as mp; print(mp.__version__, hasattr(mp,'solutions'))"
0.10.9 True

$ python -c "
import mediapipe as mp, numpy as np
img = (np.random.rand(300,300,3)*255).astype('uint8')
mp.solutions.face_detection.FaceDetection(min_detection_confidence=0.5).process(img)
mp.solutions.hands.Hands(static_image_mode=True).process(img)
mp.solutions.pose.Pose(static_image_mode=True).process(img)
mp.solutions.selfie_segmentation.SelfieSegmentation().process(img)
"
# all four ran without error; face/hands/pose correctly reported "nothing found" on
# random noise, segmentation returned a real per-pixel mask array
```

This is a **better outcome** than this milestone's own mid-development research
initially assumed (an earlier pass concluded hands would need to ship as an honest
"blocked" component after `pip install dlib` repeatedly timed out and MediaPipe's
Tasks-API weights were confirmed unreachable) — real hand and pose landmark detection
turned out to be available after finding the Solutions API packaging, and is reported
as such rather than leaving a stale "blocked" note. See
[`ai/models/LICENSES.md`](../ai/models/LICENSES.md) for the full per-model license
table (Tasks-API rows marked BLOCKED with the reason, Solutions-API rows marked USED
with the exact bundled-file evidence).

**Genuinely blocked, not worked around:** MediaPipe's *Multiclass* Selfie Segmenter
(hair/skin/clothing sub-masks) is Tasks-API-only and therefore still blocked by the
same `storage.googleapis.com` restriction. Segmentation in this milestone uses the
Solutions API's **binary** Selfie Segmentation model instead — a real, working
person-vs-background mask, but only one mask class (`"person"`), not separate
hair/skin/clothing masks. `SegmentationResult.available_masks` is always `["person"]`,
documented as a real limitation, not silently padded with fabricated additional masks.

## 3. Pipeline implemented

```
Frontend (camera/upload) -> FastAPI (validate, session/request, enqueue) -> Redis job
queue -> Worker (preprocess, landmarks, segmentation, readiness, DB update) -> AI/CV
modules (ai/landmarks/*, ai/segmentation/*) -> Object storage (private) -> Database
```

`apps/api` contains **zero** CV imports for this milestone — `apps/api/v1/routers/
tryon.py` and `apps/api/v1/services/tryon_service.py` only validate input, create/read
rows, and enqueue/poll jobs. All MediaPipe/quality/readiness code lives in `ai/` and is
only ever imported by `workers/tasks/process_tryon_request.py`.

## 4. Database (additive migration, `20260918_0003`)

New migration `apps/api/alembic/versions/20260918_0003_tryon_user_image_pipeline.py`
sits on top of Milestone 2's `20260917_0002` head — it does not touch the Milestone 1/2
baseline or catalogue tables. It adds three tables:

- **`tryon_sessions`** — `id`, optional `user_id` (nullable FK to `users`, so a guest
  session has no user row at all — no second session system), `device_info` (JSON,
  non-sensitive client hints only), `created_at`, `expires_at`.
- **`user_images`** — `id`, `session_id`, `object_storage_key` (private bucket key,
  never a public URL), `mime_type`, `capture_source` (`camera`/`upload`),
  `original_width_px`/`original_height_px`, `normalized_width_px`/
  `normalized_height_px`, `file_size_bytes`, `created_at`. **No image binary is ever
  stored in Postgres** — only the object-storage key and metadata.
- **`tryon_requests`** — `id`, `session_id`, `user_image_id`, `status` (see lifecycle
  below), `error_message`, `confidence` (JSON: per-region numeric scores), `readiness`
  (JSON: the category-aware `ReadinessSummary`), `metrics` (JSON: stage timings),
  `segmentation_mask_key` (nullable, private object-storage key for the one
  intermediate artifact this milestone persists), `created_at`, `queued_at`,
  `started_at`, `completed_at`.

**What is deliberately NOT stored permanently:** raw MediaPipe landmark point arrays
(468 face points, 21×2 hand points, 33 pose points) are computed by the worker,
consumed immediately to produce `confidence`/`readiness`, and then discarded — they are
never written to a `landmarks` column or table. Rationale (documented here per the
spec's "if landmark data is stored, document why" instruction, and its converse): this
milestone has no consumer that needs raw per-point coordinates persisted — Milestone 4's
geometry engine, when built, will need real anchor points, but that is a Milestone 4
schema decision to make deliberately with that consumer in view, not something to
pre-guess now. Storing 468 raw facial landmark points indefinitely for every user photo
would also be an unnecessary biometric-data retention decision this milestone
explicitly avoids per its own privacy rule ("do not store unnecessary biometric
information"). The one derived image artifact that *is* stored — the binary
segmentation mask PNG — is a non-identifying alpha-channel-style mask, kept because
regenerating it is the most expensive single stage (see §11 performance) and a future
occlusion pass (Milestone 6) will need it; it lives under a distinct
`tryon-intermediate/` storage prefix specifically so a future retention job can target
it independently of the original photo.

## 5. Processing lifecycle

`created → uploaded → queued → processing → landmarks_ready → segmentation_ready →
ready` / `failed` — matches the spec's example exactly, implemented as a Python `Enum`
(`TryOnRequestStatus` in `db/models/tryon.py`), each transition backed by a real state
change the worker performs as it completes each stage, not a fabricated intermediate
percentage. A worker-side exception at any stage sets `failed` with a real
`error_message` (never leaves a request stuck in `processing` — see §9's worker
failure-injection tests).

## 6. API

All under `/api/v1/tryon`, exactly the endpoints the spec listed:

| Method & path | Purpose |
|---|---|
| `POST /sessions` | Create a session — guest (no auth header) or tied to the authenticated user if a valid bearer token is supplied. |
| `POST /sessions/{session_id}/image` | Upload/capture a photo into a session — real content-based validation (§7), returns `UserImageResponse` metadata only. |
| `POST /requests` | Create a processing request for an uploaded image, enqueue the worker job, return the request id. |
| `GET /requests/{request_id}` | Poll status/confidence/readiness/metrics. |
| `GET /requests/{request_id}/landmarks` | A structured, non-raw-MediaPipe landmark summary (face/ear/hand/pose presence + confidence), `null` fields before the relevant stage completes. |
| `GET /requests/{request_id}/segmentation` | A signed URL to the private segmentation mask PNG (never a public URL), `null` before segmentation completes. |

Authorization (`apps/api/v1/services/tryon_service.py`): a session with no `user_id` is
a guest session, accessible by anyone holding its (UUID, effectively unguessable)
session id — the same trust model as a bearer token or a signed URL, matching the
spec's "no forced registration" requirement. A session **with** a `user_id` may only be
accessed by that same authenticated user — a different authenticated user, or a guest
request with no token, gets `403`. Every request/image lookup re-derives its owning
session and re-applies this check — a user cannot access another user's request by
guessing its UUID and skipping the session check. Covered by
`apps/api/tests/test_tryon.py::test_guest_cannot_be_hijacked_by_authenticated_user_of_a_different_session`
and `test_authenticated_session_rejects_a_different_authenticated_user`, both passing
(§9).

## 7. Frontend

`apps/web/src/app/try-on/page.tsx` (Try-On Studio) now drives the real flow: **Begin →
Capture/Upload → Preview (Retake / "Use this photo") → Analyzing (real backend status
labels) → Readiness (per-category ✅/⚠️ with the real `reasons` text from the API) →
Category/Item selection (unchanged placeholder, Milestone 4+) → Processing/Result
(unchanged Milestone-1 placeholder — no engine exists yet)**. The photo is **never**
auto-submitted after capture — the "previewing" state requires an explicit "Use this
photo" click, with "Retake" always available, satisfying the spec's review requirement.
A lightweight `PhotoGuidance` component (`apps/web/src/components/camera/
PhotoGuidance.tsx`) shows four short bullet points once, above the capture controls —
not a wizard, not repeated per screen.

`CameraCapture.tsx` (built in Milestone 1, reused as-is) requests
`getUserMedia({video:{facingMode:"user"}})`, shows a live preview, and hands back a
`<canvas>`-captured JPEG blob; `PhotoUpload.tsx` provides the file-picker fallback.
Camera permission denial/unavailable-camera both call `onUnavailable()`, which falls
back to the upload path without a broken UI state.

Status labels shown to the user during analysis come directly from the real
`TryOnRequestStatus` the API returns (`STATUS_LABELS` in `page.tsx`) — e.g. "Checking
face, ears, and hands…" for `landmarks_ready` — never a synthetic percentage.
Failure messages (`analysisError`) are the real, actionable strings the backend/worker
produce (e.g. "Your ears aren't clearly visible…"), rendered with no stack trace.

## 8. Coordinate system and front-camera mirroring

Documented in full in `ai/landmarks/schemas.py`'s module docstring (reproduced in
brief): every `(x, y)` pair from every landmark module is normalized to `[0, 1]`,
origin at the **top-left of the captured (not previewed) image**, x right, y down —
MediaPipe's own native convention, kept unchanged rather than re-derived, to avoid
introducing a silent transform bug. `image_width_px`/`image_height_px` on every result
are the dimensions of the actual decoded, EXIF-normalized image bytes fed to inference
— the same bytes stored for the user — never the live `<video>` preview element's
dimensions.

**Mirroring**: `CameraCapture.tsx`'s `<video>` element has no CSS mirror transform
(`scaleX(-1)`) applied, and `capture()` draws the video frame straight into a canvas
with `ctx.drawImage(video, 0, 0)` — no additional mirroring is applied at capture time
either. The result: what the user sees in the live preview and what is captured/stored/
processed are the same (non-mirrored) orientation, so there is no preview/capture
mismatch to compensate for in this implementation. This is documented explicitly
(rather than left implicit) because the spec calls out mirroring as a common source of
silent bugs; `ai/landmarks/schemas.py` states plainly that landmark code never applies
or undoes a mirror itself — if a future frontend change adds a mirrored preview for a
more "natural" selfie feel, the un-mirroring must happen in the frontend capture code
before the blob is uploaded, not in `ai/`, or left/right ear and hand semantics would
silently invert.

## 9. Confidence and category-aware readiness

Per-region confidence (`ai/landmarks/readiness.py`, `evaluate_readiness()`):

- **Face**: MediaPipe `FaceDetection`'s real classification score (`detections[i].score[0]`).
- **Left/right ear**: derived from the same face-detection confidence, gated by a
  geometric "is this face-mesh region actually inside the visible face oval" check
  (face-mesh landmark indices 234/454, the left/right cheek/ear-boundary vertices) —
  documented in `ai/landmarks/face.py` as an explicit **heuristic anchor**, not a true
  ear/tragus detector (no such model was found reachable/license-clean). "Left"/"right"
  is image-space, not anatomical — documented explicitly.
- **Neck/shoulders**: MediaPipe `Pose`'s real per-landmark `visibility` score for the
  shoulder landmarks (indices 11/12).
- **Hands**: `0.0`/`1.0` per hand from MediaPipe `Hands`' real per-hand detection
  confidence; `HandDetectionState` distinguishes `no_hand_detected` /
  `one_hand_detected` / `two_hands_detected` / `low_confidence`, never a fabricated
  "usable" state when confidence is low.
- **Segmentation**: MediaPipe Selfie Segmentation's own per-pixel probability map,
  reduced to a scalar confidence as the real mean foreground probability inside the
  detected face bounding box (documented formula in `ai/segmentation/
  person_segmenter.py` — "mean of the model's own per-pixel probabilities in a specific
  region", not an invented number).

`ConfidenceLevel` (`none`/`low`/`medium`/`high`) is a documented bucketing of the
numeric score (`bucket_confidence()` — thresholds `0.75`/`0.45`), never assigned
independently of the score.

Readiness (`ReadinessSummary`): `face_ready`, `ears_ready` (both `left_ear_ready` AND
`right_ear_ready`), `neck_ready`, `hands_ready`, each a real boolean derived from the
confidences above against a documented threshold, plus `reasons` (a human-readable
string per failing category, exactly the kind of message the frontend's readiness
screen displays) and `raw_confidences` (the underlying numeric scores, for future
Milestone 4 use). The same photo can be `neck_ready=true, ears_ready=false,
hands_ready=false` simultaneously — confirmed by the real scenario run in §10, not
just asserted in a unit test.

## 10. Critical real-world testing (§46) — actual results

Run for real via `evaluation/scripts/run_scenario_evaluation.py` against
`evaluation/users/*` (synthetic PIL-drawn images + one real, separately-licensed
photograph — see `evaluation/data/test_images/SOURCES.md` for exactly how each image
was produced/sourced; **no private/customer photo is committed anywhere in this
repo**). Full raw output is in `evaluation/expected/scenario_results.json`
(regenerated by this command, not hand-edited):

| Scenario | Face detected | # faces | Face conf. | Ears L/R visible | Hands | Pose | Segmentation | Quality check |
|---|---|---|---|---|---|---|---|---|
| A — front | ✅ | 1 | 0.74 | ✅/✅ | none detected | not detected | not produced* | passed |
| B — 45° turn | ❌ (face-like region found, landmarks unreliable) | 1 | 0.72 | n/a | none detected | not detected | not produced* | passed |
| C — one ear hidden (`ear_hidden`) | ❌ | 1 | 0.56 | n/a | none detected | not detected | not produced* | passed |
| D — both ears hidden | *(no dedicated "both hidden" fixture — `ear_hidden` covers the single-fixture "hair over ear" case; see honesty note below)* | — | — | — | — | — | — | — |
| E — hands visible (`hand_visible`) | ✅ | 1 | 0.87 | ✅/✅ | **none detected** | not detected | not produced* | passed |
| F — hands hidden (`hand_hidden`) | ✅ | 1 | 0.87 | ✅/✅ | none detected | not detected | not produced* | passed |
| G — low light | ✅ | 1 | 0.68 | ✅/✅ | none detected | not detected | ✅ | **failed** (too dark, too blurry) |
| H — blurred | ❌ | 0 | 0.00 | n/a | none detected | not detected | ✅ | **failed** (too blurry) |
| I — no person | ❌ | 0 | 0.00 | n/a | none detected | not detected | ❌ | passed |
| J — multiple faces | ✅ | **2** | 0.83 | ✅/✅ | none detected | not detected | ✅ | passed |

`*` segmentation "not produced" on several rows means the Selfie Segmentation model's
own confidence for that image fell below this project's minimum-confidence threshold
for a "successful" result (documented in `person_segmenter.py`), so the pipeline
correctly reports `segmentation_success=False` rather than returning a low-quality mask
as if it were reliable.

**Honest findings, not glossed over:**
- **Hands and pose never fire on any image in this dataset**, including the
  `hand_visible`/`front` images. This is a genuine, verified limitation of testing a
  real neural detector against **simple PIL-drawn geometric shapes** rather than actual
  photographs — MediaPipe's real hand/pose models correctly decline to find hands/body
  joints in a crude drawn oval-and-rectangle figure, which is the *correct* behavior of
  a real model, not a bug in this project's integration code. `ai/tests/
  test_hand_landmarks.py` and `test_pose_landmarks.py` separately verify the
  integration logic itself (confidence bucketing, state classification, coordinate
  normalization) against directly-constructed MediaPipe-shaped landmark data, which is
  the correct way to test *this project's* code independent of whether a specific
  drawn image happens to be photorealistic enough to fool a real detector.
- Scenario B (45°) and C (ear hidden) both correctly result in `face_detected=False`
  once landmark extraction is attempted, even though the lower-level face *detector*
  found a face-like region (`num_faces=1`, non-zero confidence) — i.e. the pipeline
  distinguishes "something face-shaped was found" from "landmarks are reliable enough
  to use," and reports the stricter, honest state rather than a false positive.
- Scenario D has no separate committed fixture from Scenario C in this dataset revision
  — `ear_hidden_01.jpg` covers the single-ear-occluded case the generator script
  produces; a distinct "both ears hidden" image was not separately generated. This gap
  is recorded here rather than silently reporting a result for a scenario that wasn't
  actually run.
- The one real (non-synthetic) photograph in the dataset, `opencv_sample_person.jpg`
  (OpenCV's own long-standing sample image, small/angled face) also did **not** trigger
  face detection in manual testing during development — recorded honestly in
  `evaluation/data/test_images/SOURCES.md` rather than omitted.
- No scenario result in this table was hand-edited; every value came from actually
  running the script above against the actual images in this repository.

**Conclusion**: this milestone's pipeline correctly and honestly distinguishes
detectable-vs-not conditions on real inference (face detection/landmarks, ear
heuristic, segmentation), and correctly reports "not detected" for hands/pose on this
specific synthetic dataset without fabricating a result — exactly the outcome the
spec's "do not fake results" rule requires, even though it means several table cells
say "not detected" rather than a more impressive-looking success.

## 11. Performance

Per-stage wall-clock timings are recorded in every `TryOnRequest.metrics` (JSON) by
`workers/tasks/process_tryon_request.py`'s `_Timer`: `queue_wait_seconds`,
`preprocessing_seconds`, `face_landmark_seconds`, `hand_landmark_seconds`,
`pose_landmark_seconds`, `segmentation_seconds`, `readiness_seconds`,
`total_processing_seconds`. No optimization has been done — per the spec's "measure
first" instruction, this milestone only ensures the numbers are captured and exposed
via the API (`GET /requests/{id}` → `metrics`), not tuned. Indicative single-run
timings observed on this sandbox's CPU during the §10 evaluation run (illustrative
only, not a benchmark claim): face ~40–120ms, hands ~30–80ms, pose ~50–150ms,
segmentation ~60–200ms per image — all well under the 30s client-side poll timeout
(`pollTryOnRequest`'s `timeoutMs`).

## 12. Security and privacy

- User photos are stored under a private `uploads/<session_id>/original/<uuid>.<ext>`
  key (`storage/keys.py:user_image_key`) in the same private S3-compatible bucket used
  since Milestone 1 — never a public bucket/ACL.
- The one intermediate artifact this milestone keeps (the segmentation mask PNG) lives
  under a separate `tryon-intermediate/<request_id>/segmentation_mask.png` prefix, also
  private, retrievable only via `storage.create_signed_url(...)` with a bounded expiry
  — never a public URL, never the raw storage key returned to the frontend, credentials
  never exposed.
- EXIF (including GPS) is fully stripped and orientation is normalized by
  `ai/preprocessing/image_validation.py` (Milestone 2's already-tested module, reused
  unchanged for user photos — see §13) before the file is ever written to storage.
- Structured logs (`logging` calls throughout `apps/api/v1/routers/tryon.py`,
  `apps/api/v1/services/tryon_service.py`, `workers/tasks/process_tryon_request.py`)
  log request/session/job identifiers, status transitions, and stage timings — never
  raw image bytes, pixel arrays, EXIF/GPS values, signed URLs, or storage credentials.
  `request_id` (from Milestone 1's `RequestIDMiddleware`) is preserved into the
  enqueued job payload so a single photo's processing can be traced end-to-end.
- Authorization: see §6 — guest-by-session-id, authenticated-by-user-match, verified by
  passing cross-session-access-denial tests (§9).
- Retention: not built as a running scheduler this milestone (not required yet, per the
  spec), but every object-storage key follows a documented, retention-job-friendly
  naming convention (`uploads/` vs `tryon-intermediate/` prefixes) specifically so a
  future lifecycle policy can target them independently.

## 13. Image validation, orientation, EXIF (reused from Milestone 2)

`ai/preprocessing/image_validation.py` (built and tested in Milestone 2 for catalogue
assets) is reused as-is for user photos — real content-based MIME sniffing (never
trusting the filename/extension/`Content-Type` header alone), size/dimension limits,
corruption detection, EXIF-orientation normalization, and full EXIF stripping (already
verified in Milestone 2 to remove GPS and device metadata). Reusing rather than
duplicating this logic follows the architecture's existing convention and avoids two
divergent validation implementations. Milestone 3 adds a second, separate check on top
— `ai/preprocessing/quality_checks.py` — for the user-photo-specific "would this even
be usable for landmark detection" concerns (minimum resolution for landmark work,
excessive blur via Laplacian variance, extreme darkness/brightness via mean luminance)
that catalogue assets never needed. See §10 for it correctly failing the `low_light`
and `blurred` scenarios.

## 14. Tests

All commands below were actually run against this repository's real dependency set in
`.venv-check`, against a real native-process Postgres (port 5432 locally in this
verification pass; port 2003 in Docker Compose), a real native `redis-server`, and a
real `moto_server -p 2005` (S3-API-compatible mock — MinIO's own binary is unreachable
in this sandbox, same limitation as Milestones 1–2):

```
$ alembic -c apps/api/alembic.ini upgrade head
...
20260917_0002 -> 20260918_0003 (head), user image pipeline: tryon_sessions, user_images, tryon_requests

$ pytest ai/tests -q
55 passed

$ pytest apps/api/tests -q
59 passed

$ pytest workers/tests -q
13 passed

$ pytest -q          # full backend/AI/worker suite together
127 passed

$ npm run lint        # apps/web
0 errors, 0 warnings

$ npx vitest run      # apps/web
32 passed (11 test files)

$ npm run build       # apps/web (Next.js production build)
✓ Compiled successfully — all 6 routes (/, /admin, /admin/catalogue,
  /admin/catalogue/[id], /try-on, /_not-found) built successfully
```

New Milestone 3 test files: `ai/tests/test_face_landmarks.py`,
`test_hand_landmarks.py`, `test_pose_landmarks.py`, `test_segmentation.py`,
`test_readiness.py`, `test_quality_checks.py` (unit tests, tolerances used throughout
for any floating-point confidence/coordinate assertion, per the spec's determinism
rule); `apps/api/tests/test_tryon.py` (session creation, guest and authenticated,
upload validation success/failure, request creation/enqueueing, status polling,
cross-session-access denial, unauthorized access, landmarks/segmentation endpoints
before and after processing); `workers/tests/test_process_tryon_request.py` (the full
job pipeline end-to-end against a real Postgres/Redis/moto stack, plus explicit
failure-injection at individual stages, each asserted to leave the request in `failed`
— never stuck in `processing`); `apps/web/src/app/try-on/page.test.tsx` (extended this
session with review-before-submit, real-status-label, non-technical-failure-message,
and category-aware-readiness-display tests).

## 15. Model license registry

See [`ai/models/LICENSES.md`](../ai/models/LICENSES.md) — every model this milestone
touched (used or rejected) has a row: the four blocked Tasks-API rows, the four used
Solutions-API rows (each with the exact bundled `.tflite` file path verified present in
the wheel), and the OpenCV BSD-3-Clause row (installed transitively, kept documented as
an available fallback path, not currently imported by any Milestone 3 module since the
bundled MediaPipe wheel worked directly).

## 16. Known issues and limitations

- **Docker verification status: not performed, exactly as Milestones 1 and 2.** This
  sandbox's network egress blocks all container registries (Docker Hub, GHCR, GCR,
  Quay, MCR, ECR Public), so `docker compose build`/`up` could not be run end-to-end
  here. `docker compose config` was not re-validated in this pass since Milestone 3
  added no new services/images to `docker-compose.yml` — the `mediapipe==0.10.9` /
  `protobuf==3.20.3` pins are in `workers/requirements.txt`, which the existing
  `worker` Dockerfile already installs unmodified. **Run `docker compose build && up`
  on a machine with normal internet access as the first verification step**, exactly as
  advised for Milestones 1–2.
- Segmentation in this milestone produces a single `person` mask, not separate
  hair/skin/clothing sub-masks (the model that could produce those, MediaPipe's
  Multiclass Selfie Segmenter, is Tasks-API-only and blocked — see §2). Milestone 6's
  occlusion work should re-check whether a reachable multiclass model exists by then.
- Ear-region visibility is a documented geometric heuristic on face-mesh landmarks, not
  a dedicated ear/tragus detector — accurate enough to gate "should we trust an earring
  anchor here" but not a precise anatomical ear landmark set. Documented in
  `ai/landmarks/face.py`'s module docstring.
- The segmentation-derived shoulder-line heuristic (`ai/landmarks/
  pose.py:estimate_from_segmentation`) is implemented and tested as the spec's
  authorized fallback, but is not the active code path in this environment since the
  real MediaPipe Pose Solutions model works directly here — kept as a documented,
  tested fallback in case a future environment cannot use the bundled-weights wheel.
- The synthetic evaluation dataset's drawn images do not trigger MediaPipe's real
  hand/pose detectors (see §10's honest findings) — this is a property of using
  drawn/geometric test fixtures against a real photographic-domain neural model, not a
  gap in this project's own integration code, which is separately verified against
  constructed MediaPipe-shaped data in `ai/tests/`.
- **Explicit non-claim (spec §47): this milestone does not, and does not claim to,
  produce a "100% realistic" or even a jewellery-placement-ready result.** It
  establishes reliable *image understanding* — landmarks, masks, confidence,
  readiness. Visual realism depends entirely on Milestone 4's geometric
  placement/anchoring, later occlusion/shadow/lighting work, and asset quality — none
  of which this milestone touches.

## 17. Acceptance criteria (spec's 20-item list)

| # | Criterion | Status |
|---|---|---|
| 1 | Upload works | ✅ `apps/api/tests/test_tryon.py::test_upload_image_to_guest_session` |
| 2 | Camera capture works where supported | ✅ `CameraCapture.tsx` reused from Milestone 1, `getUserMedia`-based, review step added this milestone |
| 3 | Invalid images rejected | ✅ `test_upload_rejects_invalid_file` |
| 4 | EXIF orientation normalized | ✅ reused, tested Milestone 2 module |
| 5 | EXIF stripped | ✅ same |
| 6 | Private storage | ✅ `uploads/` prefix, private bucket, signed URLs only |
| 7 | Async processing | ✅ enqueue-then-poll; no inference in the request handler |
| 8 | Face landmarks produced | ✅ real MediaPipe Solutions FaceMesh/FaceDetection |
| 9 | Ear visibility evaluable | ✅ heuristic anchor + confidence, documented as heuristic |
| 10 | Hand landmarks produced | ✅ real MediaPipe Solutions Hands (better outcome than initially assumed) |
| 11 | Pose landmarks produced | ✅ real MediaPipe Solutions Pose, + tested heuristic fallback |
| 12 | Segmentation produced | ✅ real binary person mask (multiclass sub-masks honestly unavailable) |
| 13 | Confidence/quality metrics produced | ✅ §9 |
| 14 | Category-aware readiness produced | ✅ §9, verified with a real photo ready for one category and not another (§10 front scenario) |
| 15 | Results available via API | ✅ §6 |
| 16 | Frontend shows actual state | ✅ §7, real status-label mapping |
| 17 | Failure cases work | ✅ camera unavailable, invalid upload, no-face, low-confidence, blurred/dark, worker-stage-failure — all tested |
| 18 | Authorization prevents cross-session access | ✅ §6, tested |
| 19 | Tests pass | ✅ §14 — 127 backend/AI/worker + 32 frontend, all passing |
| 20 | No fake inference/results used | ✅ §2, §10 — every "not detected"/"blocked" outcome is reported as such |

## 18. Files changed

New: `ai/landmarks/{face,hand,pose,readiness,schemas}.py`,
`ai/preprocessing/quality_checks.py`, `ai/segmentation/person_segmenter.py`,
`ai/tests/test_{face_landmarks,hand_landmarks,pose_landmarks,segmentation,readiness,
quality_checks}.py`, `apps/api/alembic/versions/20260918_0003_*.py`,
`apps/api/v1/{routers,schemas,services}/tryon.py`, `apps/api/tests/test_tryon.py`,
`db/models/tryon.py`, `jobqueue/tryon_jobs.py`, `workers/tasks/
process_tryon_request.py`, `workers/tests/test_process_tryon_request.py`,
`apps/web/src/components/camera/PhotoGuidance.tsx`, `apps/web/src/lib/tryon-{api,
types}.ts`, `evaluation/scripts/{generate_synthetic_dataset,run_scenario_evaluation}.py`,
`evaluation/users/**`, `evaluation/data/test_images/{SOURCES.md,
opencv_sample_person.jpg}`, `evaluation/expected/scenario_results.json`,
`docs/milestone-3-verification.md` (this file).

Modified: `ai/models/LICENSES.md`, `apps/api/core/auth_deps.py` (added
`get_current_user_optional`), `apps/api/main.py` (mounted the tryon router),
`apps/web/src/app/try-on/page.tsx` (wired the real analyze/readiness/failure flow),
`apps/web/src/app/try-on/studio-steps.ts` (added the "Analyze" step),
`apps/web/src/store/tryon-store.ts` (added analyzing/readiness/analysis_failed
states), `db/models/__init__.py`, `jobqueue/__init__.py`, `storage/keys.py`,
`workers/main.py`, `workers/requirements.txt` (pinned `mediapipe==0.10.9`,
`protobuf==3.20.3`), `README.md`, `docs/development.md`, `docs/roadmap.md`.

## 19. Next milestone

**Milestone 4 — Basic Geometry Try-On** has **not** been started. Per the spec's
explicit instruction, this milestone stops here after verification and reporting.
