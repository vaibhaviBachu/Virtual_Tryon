# Live AR Architecture — Milestone 5

This document describes the **Live AR Try-On Studio**: real-time, camera-based jewellery
try-on that runs continuously in the browser, with no photo capture required to see
jewellery on your body. It is a second, separate mode alongside the existing photo
Try-On Studio (Milestones 3–4), not a replacement for it.

**Honesty framing (read this before anything else in this document):** what is built
here is the **live geometry baseline** — real-time tracking, real-time 2D geometry,
smoothing, and Canvas 2D compositing. It is explicitly **not** photorealistic, does not
model lighting, shadows, depth, or occlusion by hair/clothing, and does not use any
generative AI. Every claim below about what works is qualified by how it was actually
verified — see [Real Device Verification](#real-device-verification-and-honest-limits)
and `docs/live-ar-verification.md`.

## Relationship to the photo try-on pipeline

| | Photo Try-On (Milestone 3–4) | Live AR (Milestone 5) |
|---|---|---|
| Trigger | User uploads/captures **one** photo | Continuous camera stream |
| Where placement is computed | Server (`ai/geometry`, `ai/landmarks`, Python MediaPipe) | Browser (`apps/web/src/lib/live-ar`, `@mediapipe/tasks-vision`) |
| Where compositing happens | Server (`ai/geometry/transform.py`, OpenCV) | Browser (`renderer.ts`, Canvas 2D) |
| Per-request backend cost | One render job per try-on | None — only catalogue reads + one optional capture upload |
| Result | A single rendered image | A live view; optionally a single captured image |

They deliberately **share**: the coordinate convention (normalized [0,1], top-left
origin), the anchor/scale/rotation formulas (`ai/geometry/*` ported to
`apps/web/src/lib/live-ar/*`), the jewellery catalogue and asset metadata
(`anchor_x`/`anchor_y`/`attachment_point`/`mirrorable`), and the `tryon_sessions` table.

They deliberately **do not share**: any server-side rendering loop, any per-frame API
call, or any generative AI step. There is no `POST /frame` endpoint anywhere in this
codebase, and there never should be one — see [API surface](#api-surface).

## Directory layout

```
apps/web/src/lib/live-ar/       Pure, framework-agnostic logic (all unit-tested)
  types.ts                      Shared types + the coordinate-system contract
  coordinates.ts                normalized -> pixel conversion, the one mirroring rule
  camera.ts                     getUserMedia wrapper with structured error codes
  tracking.ts                   MediaPipe Tasks-Vision (FaceLandmarker/PoseLandmarker)
  body-reference.ts             Shoulder reference frame (ports ai/geometry/body_reference.py)
  geometry.ts                   Anchor/scale/rotation/plan (ports ai/geometry/{anchors,scale,rotation}.py)
  asset-cache.ts                Texture + alpha-bbox loading/caching (ports ai/geometry/asset_geometry.py)
  smoothing.ts                  EMA smoothing (position/scale/rotation)
  tracking-state.ts             GOOD/DEGRADED/LOST state machine
  readiness.ts                  Live category readiness (ports ai/landmarks/readiness.py)
  renderer.ts                   Canvas 2D compositing
  performance.ts                FPS/frame-time/dropped-frame instrumentation
apps/web/src/components/live/   React glue (imperative loop, UI)
  useLiveArSession.ts           Owns the camera/trackers/render loop
  LiveArStudio.tsx              The Studio UI
apps/web/src/app/try-on/live/   The route (separate from /try-on)
apps/web/src/lib/live-ar-api.ts Client for the two backend endpoints Live AR has
apps/api/v1/routers/live_ar.py  POST/GET capture endpoints (no per-frame route)
apps/api/v1/services/live_ar_service.py
apps/api/v1/schemas/live_ar.py
db/models/live_ar.py            LiveArCapture model
apps/api/alembic/versions/20260918_0005_live_ar_captures.py
```

This mirrors the existing project's separation of pure logic (`ai/`) from framework glue
(`apps/api/v1/routers`, `apps/web/src/app`), adapted to the browser: `lib/live-ar/*` has
no React/DOM dependency it doesn't need to (only `camera.ts`/`asset-cache.ts`/
`tracking.ts` touch browser APIs, and each does so behind a small, mockable surface,
which is what makes the rest unit-testable in Node/jsdom).

## Camera pipeline

`camera.ts`'s `startLiveCamera()` wraps `navigator.mediaDevices.getUserMedia()`, distinct
from the existing one-shot `components/camera/CameraCapture.tsx` (photo pipeline).
Differences: it requests a capped resolution (960×720 ideal, 1280×960 max) rather than
the device's maximum — real-time tracking does not benefit from more pixels than that at
typical webcam distances, and a smaller frame is cheaper to track and composite every
frame — and it classifies failures into `CAMERA_PERMISSION_DENIED` / `NO_CAMERA` /
`CAMERA_UNAVAILABLE` (spec-required codes) rather than one generic error.

A single `<video>` element holds the live decoded stream; a `<canvas>` of identical pixel
dimensions is drawn on top of it every frame (video frame + jewellery composited
together) and is also what is captured for the "final capture" feature (see
[Capture](#capture)). No image `<img>` elements are created or replaced per frame.

## Coordinate systems and mirroring

**This is the single most safety-critical piece of this milestone** — get it wrong and
a left earring renders on the right ear.

Four coordinate systems are named explicitly in `types.ts` and `coordinates.ts`:

1. **CAMERA** — the raw, unmirrored `<video>` pixel buffer.
2. **TRACKING** — MediaPipe's landmark results, computed against that same unmirrored
   buffer (MediaPipe never sees a mirrored image).
3. **RENDERING** — the jewellery `<canvas>`, sized identically to the video and drawn
   using the **same unmirrored pixel coordinates as tracking**. This is a deliberate
   design choice: rendering space is kept numerically identical to tracking space so
   there is no conversion step between "where MediaPipe says the ear is" and "where the
   canvas draws the earring" — eliminating an entire class of mirroring bugs by
   construction, not by careful bookkeeping.
4. **DISPLAY** — mirroring is applied **exactly once**, via a single CSS
   `transform: scaleX(-1)` on one wrapper `<div>` that contains **both** the `<video>`
   and the `<canvas>` together (`useLiveArSession`'s `mirrorTransform`,
   `containerMirrorTransform()` in `coordinates.ts`). Mirroring is never applied to an
   individual coordinate, landmark, or transform anywhere in this codebase.

Because both the camera image and the jewellery are inside the same mirrored wrapper,
they mirror together — a left-ear anchor computed in tracking space always lands under
the visually-left ear on screen, whether or not the preview happens to be shown mirrored.
`coordinates.test.ts` has a regression test asserting `denormalize()` takes no "mirrored"
parameter at all, specifically to catch a future change that tries to mirror points
individually.

**Capture** reads pixels directly from the canvas's underlying (unmirrored) buffer via
`canvas.toBlob()`, so a captured image is always unmirrored — consistent with the
existing photo pipeline's own documented policy (`ai/landmarks/schemas.py`).

The Live AR preview **is** mirrored (unlike the existing photo capture preview, which is
not) — a deliberate, different choice for a continuous live-camera UX, where "looking in
a mirror" is the expected feel; a one-shot photo capture has no such expectation.

## Tracking

`tracking.ts` wraps `@mediapipe/tasks-vision`'s `FaceLandmarker` and `PoseLandmarker` in
`VIDEO` running mode — a **browser-native**, real-time tracker, never the photo
pipeline's server-side Python MediaPipe usage (`ai/landmarks/face.py`,
`ai/landmarks/pose.py`), and never a per-frame call to any backend.

Honest limitation: Tasks-Vision's `FaceLandmarker` does not expose a graded detection
confidence in `VIDEO` mode — only presence/absence of a face for the frame. This module's
`detectionConfidence` is therefore a real but coarse binary signal (1.0/0), not a
fabricated fine-grained score. `PoseLandmarker` **does** expose real per-landmark
`visibility`, so `shoulderConfidence` is computed identically to
`ai/landmarks/pose.py`'s `shoulder_confidence` (average of the two shoulder landmarks'
visibility) — this one is not degraded.

## Live geometry (anchor, scale, rotation)

`geometry.ts`, `body-reference.ts` are direct TypeScript ports of
`ai/geometry/{anchors,scale,rotation}.py` and `ai/geometry/body_reference.py`, kept
numerically parallel to the Python originals (mirrored test names in
`geometry.test.ts`/`body-reference.test.ts`; see also
`ai/tests/test_geometry_anchors.py`, `test_geometry_rotation.py`,
`test_geometry_scale.py`, `ai/tests/test_body_reference.py`). The design keeps GEOMETRY
(a `LiveTransform` — a handful of numbers) strictly separate from IMAGE COMPOSITING
(`renderer.ts`) — nothing in `geometry.ts` touches a canvas or an image.

**Deliberate divergence from the Python earring rotation formula:** this milestone's
own audit (and the necklace-rotation sign-inversion bug fixed earlier this session)
found that `ai/geometry/rotation.py`'s `_compute_earring_rotation` uses FaceMesh
landmarks 234/454 by **fixed index** as "left"/"right", while
`ai/landmarks/face.py`'s own ear-anchor code resolves left/right **dynamically** by
comparing x-coordinates (`edge_a.x <= edge_b.x`). That fixed-index assumption is exactly
the bug pattern that caused the confirmed necklace bug. Rather than risk shipping the
same pattern in new code, `computeEarringRotation` uses the dynamic, safer convention.
The existing Python file was **not** changed — this is out of Milestone 5's scope and
the inconsistency was not otherwise reported or reproduced there; it is called out here
as a known latent risk in `ai/geometry/rotation.py` for a future milestone to address.

`planCategoryRenders()` combines the per-category math into the per-frame render plan:
one slot for a necklace, or both left+right slots for earrings (mirroring the right
slot's transform, not decoding a second image, when the asset is marked `mirrorable`).

## Asset loading and caching

`asset-cache.ts` fetches the jewellery's processed asset image **once per selection**
(never per frame) and computes its alpha-channel bounding box via a hidden canvas — the
browser equivalent of `ai/geometry/asset_geometry.py`'s numpy alpha scan, with the same
default-anchor rule (top-center of the visible bbox) when no catalogue `anchor_x`/
`anchor_y` is set. Both the decoded image and the computed geometry are cached by asset
id. Switching jewellery does not re-fetch or re-scan an asset already in the cache, does
not restart the camera, and does not make a render request.

## Smoothing

`smoothing.ts` uses a **time-constant-based exponential moving average (EMA)**, not a
fixed per-frame alpha (so it adapts to variable camera frame intervals), applied
independently to each `LiveTransform` component (anchor x/y, scale, rotation — rotation
via an angle-aware variant that unwraps the ±180° boundary so it never "spins" the
jewellery). **Why EMA and not One Euro or Kalman**: the actual problem to solve is
removing single-frame landmark jitter at 24–30 FPS without visible lag for slow,
typical try-on movements (a customer standing mostly still, turning their head slowly).
EMA is the simplest filter that does this well; One Euro/Kalman would trade implementation
and tuning complexity for a velocity-aware lag/jitter trade-off this milestone doesn't
need. **Trade-off, stated honestly**: a plain EMA lags more than a velocity-aware filter
during fast motion. `DEFAULT_SMOOTHING_TIME_CONSTANT_MS` (120ms) is a starting point,
exposed as a constructor parameter specifically so it can be retuned without changing
the smoothing architecture, once real-device testing (see verification doc) shows
whether it needs adjustment.

## Tracking loss handling

`tracking-state.ts` implements exactly the three states the spec requires:
`TRACKING_GOOD` (fresh, usable transform), `TRACKING_DEGRADED` (a bad frame within
`TRACKING_DEGRADED_GRACE_MS` — the last good transform is held, frozen, at full opacity;
the jewellery never flickers on one noisy frame or a brief occlusion), and
`TRACKING_LOST` (the grace period elapsed — the jewellery fades from full to zero
opacity over `TRACKING_LOST_FADE_MS`, then stays hidden). A good frame at any point
returns to `TRACKING_GOOD` immediately — there is no artificial re-acquisition delay.
Nothing is ever left frozen on screen indefinitely.

## Rendering technology: Canvas 2D (not WebGL/WebGPU)

A deliberate v1 choice, not a shortcut — see `renderer.ts`'s docstring for the full
reasoning. Short version: the actual per-frame work is compositing one small
transparent sprite (translate + rotate + uniform scale + alpha blend), which
`CanvasRenderingContext2D.drawImage` is hardware-accelerated for in every evergreen
browser; Canvas 2D has no capability gate to feature-detect around (unlike WebGPU) and
needs no shader compilation, keeping "switching jewellery must not freeze the camera"
trivially true. The `LiveTransform` contract is deliberately renderer-agnostic (plain
numbers, no canvas-specific state) so a WebGL/WebGPU backend can be added later for
depth-aware occlusion or shader-based material rendering without touching tracking,
geometry, or smoothing.

## Category readiness

`readiness.ts` extends Milestone 3's readiness concept
(`ai/landmarks/readiness.py`) with a `DEGRADED` middle state between fully-ready and
not-ready — needed for continuous video (a photo either is or isn't usable; a live
stream can be *marginally* usable one frame and unusable the next), so the UI can say
"hold still" instead of flickering between ready and not-ready near the confidence
threshold. Reuses the same threshold constants
(`FACE_CONFIDENCE_THRESHOLD`/`EAR_CONFIDENCE_THRESHOLD`/`NECK_CONFIDENCE_THRESHOLD`).

## Capture

`useLiveArSession().captureFrame()` reads the **current on-screen composite** (video +
jewellery, already drawn together on the render canvas) via `canvas.toBlob()` and
returns a single JPEG blob — no separate re-render, no substitution of a different
jewellery position than what was on screen at that moment. `LiveArStudio` posts that one
blob to `POST /api/v1/live-ar/captures`; nothing else is ever sent to the backend.

## Privacy

The camera stream (`MediaStream`) never leaves the browser. No frame is ever sent to the
backend, logged, or persisted, except the single composited image the user explicitly
captures. No continuous video, and no raw biometric landmark coordinates, are stored
anywhere in the database for Live AR — `live_ar_captures` stores only the same kind of
metadata `user_images` already stores for the photo pipeline (dimensions, mime type, a
private storage key), never landmark data.

## API surface

Live AR intentionally has almost no new backend surface:

- `GET /api/v1/catalog/categories`, `GET /api/v1/catalog/jewellery`,
  `GET /api/v1/catalog/jewellery/{id}/assets`, `GET /api/v1/catalog/assets/{id}` —
  all pre-existing, reused unchanged.
- `POST /api/v1/tryon/sessions` — pre-existing, reused unchanged for a Live AR session.
- `POST /api/v1/live-ar/captures`, `GET /api/v1/live-ar/captures/{id}` — the **only**
  two new endpoints, both operating on a single already-composited image.
- **There is no per-frame endpoint anywhere in this codebase**, and there must never be
  one added: doing so would violate the milestone's central architectural rule (the live
  rendering hot path runs in the browser, not the server).

## Database changes

One new, additive table: `live_ar_captures` (migration `20260918_0005`), reusing
`tryon_sessions` via foreign key. It is deliberately **not** built on
`tryon_requests`/`tryon_renders`: those represent Milestone 3/4's "analyze then render"
server-side pipeline, which a Live AR capture never goes through — the browser already
did tracking, geometry, and compositing before the image was ever sent. Building on
those tables would mean fabricating pipeline-stage statuses (e.g. `landmarks_ready`)
that never actually happened, which this codebase's own conventions explicitly reject.

## Performance instrumentation

`performance.ts`'s `PerformanceTracker` records only real, measured per-stage timings
(tracking/geometry/render, in milliseconds) over a rolling window of recent frames, and
computes FPS from the actual recorded frame times — never a hardcoded or estimated
number. `LiveArStudio` exposes this as an opt-in overlay (off by default, so the
customer-facing UI stays a retail experience, not a dev tool), formatted exactly per the
spec's example: `FPS: 29 / Tracking: 8.0ms / Geometry: 0.4ms / Render: 2.0ms / Total: 10.4ms`.

## Known limitations

- **No occlusion.** Jewellery is drawn on top of everything; hair, hands, or clothing
  passing in front of it will not occlude it. This is explicitly deferred, not
  implemented partially or faked.
- **2D rotation only**, no 3D head-pose estimation — same limitation as the photo
  pipeline.
- **Anthropometric-average scale calibration**, not per-user physical measurement — same
  limitation as the photo pipeline, and Live AR's catalogue does not currently expose
  `physical_width_mm` to the browser at all (the API doesn't return it), so Live AR
  always uses the relative-scale fallback path today, never the physical-mm path.
- **`FaceLandmarker`'s VIDEO-mode confidence is coarse** (presence/absence only) — see
  [Tracking](#tracking).
- **The existing `ai/geometry/rotation.py` earring-rotation fixed-index convention was
  not fixed** — see [Live geometry](#live-geometry-anchor-scale-rotation).
- **A single mirrorable-asset design is assumed for a symmetric earring pair** — an
  intentionally asymmetric left/right earring design (two different assets) is not
  modeled; `planCategoryRenders()` always renders both slots from one asset.
- **No occlusion / lighting / shadow / material realism** — by design, see
  [Future realism architecture](#future-realism-architecture).

## Future realism architecture (not implemented now)

The `LiveTransform`/renderer boundary is deliberately renderer-agnostic so later work
can add, without redesigning tracking or geometry: depth-aware occlusion (hand/hair/
clothing segmentation gating the jewellery layer), a WebGL/WebGPU rendering backend for
shader-based lighting/material rendering, temporal stabilization beyond simple EMA
smoothing, perspective-aware (3D) rendering, shadow synthesis, and optional AI-based
post-capture harmonization (never in the per-frame live loop). None of this is built in
this milestone.

## Real device verification and honest limits

See `docs/live-ar-verification.md` for exactly what was and was not verified, and why.
In short: every pure logic module (`lib/live-ar/*` except `camera.ts`'s actual
`getUserMedia` call and `tracking.ts`'s actual model load) is unit-tested and passing in
this repository's CI-equivalent sandbox. The camera permission flow, real MediaPipe
model loading (the model files are fetched from Google's CDN at runtime, which this
development sandbox's network cannot reach), on-screen tracking accuracy, real-device
frame rate, and cross-browser behavior have **not** been exercised against a real camera
or browser from this sandbox and require verification on the user's own machine.
