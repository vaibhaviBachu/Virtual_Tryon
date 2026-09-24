# Live AR Realism Verification (M6.2, M6.3, ...)

One document per milestone section below, each self-contained and dated to what was
actually implemented and verified at the time — later sections do not retroactively
change earlier claims.

---

**Scope: M6.2 only.** This records exactly what M6.2 implemented and verified —
landmark z wired into the Live AR geometry/data pipeline as a foundation for later
occlusion/perspective work (docs/live-ar-realism-architecture.md §5/§13/§17). It does
**not** implement segmentation, occlusion, shadow, perspective, lighting, or any visual
change to the customer-facing Live AR experience. The accurate summary of this milestone
is: *relative landmark depth is now available to the Live AR geometry pipeline, exposed
through a small pure module and passed through into existing data structures, as a
foundation for subsequent occlusion work* — not "depth-aware rendering is implemented,"
because nothing renders using it yet.

## What `z` means in this project (verified, not assumed)

Per Google's own published MediaPipe documentation (see Sources):

- **FaceLandmarker**: `z`'s origin is the center of the head. Smaller (more negative) z
  means closer to the camera. Magnitude is roughly on the same normalized scale as x/y.
- **PoseLandmarker**: `z`'s origin is the midpoint of the hips. Same "smaller = closer"
  direction, same roughly-x-scale magnitude.
- **Critical, easy-to-miss caveat verified during this milestone**: these are two
  *different* origins. A FaceLandmarker z value and a PoseLandmarker z value are not
  expressed relative to the same point in space — subtracting one from the other would
  look like a valid number but would not describe a real physical depth difference. This
  project's new depth module (`depth.ts`) therefore only ever compares z values known to
  come from the same model result (two landmarks from one FaceLandmarker call, or two
  from one PoseLandmarker call). Cross-model (face-vs-pose) depth comparison is out of
  scope until a deliberate, verified normalization step is added — not attempted here.
- Missing/`NaN`/`Infinity` z is always represented as an explicit `null` ("unavailable"),
  never as `0` or any other fabricated placeholder.

## How it flows through the system

```
MediaPipe FaceLandmarker/PoseLandmarker (tracking.ts, already captured .z -- unchanged)
   -> depth.ts's compareRelativeDepth() / computeShoulderDepthAsymmetry() (NEW, pure)
   -> BodyReferenceFrame.shoulderDepth (body-reference.ts, NEW field)
   -> NeckReferenceFrame.shoulderDepth (neck-reference.ts, passthrough, NEW field)
   -> AnchorResult.bodyDepth (geometry.ts's computeNecklaceAnchor, passthrough, NEW field)
   -> NecklaceDebugSnapshot's depth fields (debug.ts, numeric-only diagnostic readout)
```

At every step this is a **passthrough**, not a decision input: nothing in
`computeScale`, `computeRotation`, `buildLiveTransform`, or `renderer.ts` reads any of
these new fields. The existing x/y/scale/rotation pipeline is unmodified logic with one
new, unread field riding alongside it.

## New pure depth abstraction (`apps/web/src/lib/live-ar/depth.ts`)

- `safeLandmarkZ(point)` — a landmark's own z, or `null` when missing/non-finite.
- `compareRelativeDepth(reference, target)` — `{ referenceZ, targetZ, deltaZ,
  targetIsCloser }`, or `null` when either z is unavailable. Documented as valid only for
  same-model landmark pairs (see above).
- `computeShoulderDepthAsymmetry(pose)` — the one concrete same-model comparison wired in
  this milestone: PoseLandmarker's own left/right shoulder landmarks (11/12), which share
  the hip-midpoint origin.

No Canvas, camera, React, or MediaPipe import inside this module — pure functions over
plain data, matching this codebase's existing convention (`smoothing.ts`, `readiness.ts`,
`tracking-state.ts` are the same shape).

## Files changed

- `apps/web/src/lib/live-ar/depth.ts` (new) + `depth.test.ts` (new, 16 tests)
- `apps/web/src/lib/live-ar/types.ts` — new `RelativeDepthComparison` interface;
  `BodyReferenceFrame.shoulderDepth`, `NeckReferenceFrame.shoulderDepth`,
  `AnchorResult.bodyDepth` (all new, all optional/nullable)
- `apps/web/src/lib/live-ar/body-reference.ts` (+2 tests) — populates `shoulderDepth`
- `apps/web/src/lib/live-ar/neck-reference.ts` (+3 tests) — passes `shoulderDepth`
  through on both the face-interpolation and no-face-fallback methods
- `apps/web/src/lib/live-ar/geometry.ts` (+4 tests, incl. the M6.2 regression block) —
  passes `bodyDepth` through on the necklace anchor only (earrings have no
  shoulder/body reference, so `bodyDepth` is `undefined` there, not applicable)
- `apps/web/src/lib/live-ar/debug.ts` (+2 tests) — extends the existing
  `NecklaceDebugSnapshot`/`formatNecklaceDebugSnapshot` diagnostic with a `DEPTH` section
  (face nose z, both shoulder z, their delta) instead of creating a second debug
  mechanism. Deliberately does **not** report a "neck z" — the neck-reference point is a
  2D interpolation with no MediaPipe landmark of its own, so reporting one would be a
  fabricated number.

Not touched: `apps/api/*`, `workers/*`, `ai/geometry/*` (Python), any Alembic migration,
`useLiveArSession.ts`, `LiveArStudio.tsx`, `renderer.ts`, `constants.ts` — this was a
browser-local, data-layer-only change; the debug UI's existing generic
`formatNecklaceDebugSnapshot()` call already picks up the new lines with no component
change needed.

## Geometry regression result (the milestone's central requirement)

`geometry.test.ts`'s new "M6.2 regression" block proves, with fixtures that differ only
in whether `z` is present:

- Necklace anchor `x`/`y` are identical to 10 decimal places with vs. without shoulder z.
- The full `planCategoryRenders` necklace transform (`anchorPx`, `scaleFactor`,
  `rotationDegrees`, `sourceAnchorPx`, `mirrored`) is `toEqual`-identical with vs. without z.
- Earring anchors are unaffected by face-edge z entirely (earrings have no body
  reference to carry depth through).
- `computeNecklaceRotation`'s output is bit-identical with or without shoulder z.

**The necklace and earrings render at exactly the same position, scale, and rotation as
before M6.2.** Visible rendering has not changed.

## Tests

- Frontend baseline before M6.2 (this session, `npx vitest run`): **162 tests, 161
  passed / 1 failed** (`JewelleryCreateForm.test.tsx`'s slug-validation test — confirmed
  flaky under the full parallel suite, passes 2/2 in isolation; unrelated to Live AR,
  not touched by this milestone).
- Frontend after M6.2: **191 tests** (162 + 29 new), same pre-existing flake behavior
  (fails intermittently under the full suite, passes in isolation) — no new failures.
- Live AR subtree alone (`npx vitest run src/lib/live-ar`) after M6.2: **150/150 passing**
  across all 15 files, including every new depth test and the regression guards above.
- `npx tsc --noEmit`: clean, no errors, before and after.

## Lint result

Before and after M6.2: **identical** — 53 problems (29 errors, 24 warnings), all
pre-existing (`react-hooks/set-state-in-effect` in unrelated components,
`no-unused-vars` in `geometry.ts` for an already-unused import predating this milestone,
and in `renderer.test.ts`). `next lint` exits 0 either way (this project's existing lint
config does not fail the process on these). M6.2 introduced zero new lint issues.

## Build result

`npm run build` (Next.js production build, Turbopack): **succeeds**, all 7 routes
compile and prerender, including `/try-on/live`. TypeScript compiles clean as part of the
build (`Finished TypeScript in 16.4s`).

## Known limitations (honest, not glossed over)

- This is a foundation only. No occlusion, shadow, perspective, or lighting exists yet —
  M6.3+ (segmentation) is the next gated step per
  `docs/live-ar-realism-architecture.md`'s own roadmap, and has not been started.
- `computeShoulderDepthAsymmetry` is the only concrete depth comparison wired end-to-end
  in this milestone. A face-internal comparison (e.g. ear-edge z asymmetry) was
  deliberately not added — it would either duplicate `geometry.ts`'s ear-resolution
  logic or introduce a new dependency edge, and nothing in this milestone consumes it, so
  it was left out rather than built speculatively.
- Real-camera verification of this specific change was not necessary and was not
  performed: M6.2 has no visual output of its own beyond the existing debug text panel's
  new `DEPTH` lines (verified by unit test, not a live camera — see this project's own
  "do not claim what wasn't checked" rule). A real-device check of the debug panel's new
  lines against an actual moving person is worth doing opportunistically before M6.3
  builds on this, but is not required to trust M6.2's own correctness claim, which rests
  on the geometry regression tests above, not on visual inspection.
- The z magnitude's real-world reliability (how noisy it is frame-to-frame, whether it's
  usable enough for M6.4's occlusion ordering) is genuinely unknown — this milestone
  deliberately did not introduce any threshold or reliability claim (per the request's
  own Step 5), leaving that evidence-gathering to M6.3's real-device proof of concept.

## Commit

`2eb825d` — "feat(live-ar): expose landmark depth for realism pipeline".

## What M6.3 will do next

Per `docs/live-ar-realism-architecture.md` §17: a standalone, real-device-verified proof
of concept loading MediaPipe's multiclass `ImageSegmenter` and rendering its category
mask to an offscreen debug overlay only — no compositing into the live jewellery layer
yet, specifically to get a real (not benchmark-borrowed) FPS number for this app's own
per-frame budget before any occlusion compositing is attempted. M6.3 has not been started
and requires separate approval, per this milestone's stop condition.

## M6.2 Sources

- [Pose landmark detection guide — Google AI Edge](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker/web_js) — PoseLandmarker z convention (hip-midpoint origin).
- [Face landmark detection guide — Google AI Edge](https://developers.google.com/mediapipe/solutions/vision/face_landmarker) — FaceLandmarker z convention (head-center origin).

---

# M6.3 Verification — Multiclass Segmentation Proof of Concept

**Scope: M6.3 only.** Answers one engineering question:
*can the multiclass `ImageSegmenter` run in the live browser loop on real hardware at an
acceptable cost?* This milestone does **not** implement jewellery occlusion — the
segmenter only drives a development-only debug visualization. Nothing about jewellery
placement/compositing changed.

## What this sandbox CAN and CANNOT verify (read this before the rest of this section)

**This development sandbox has no camera and cannot reach a real browser session with
`getUserMedia` permission.** Every automated/code-correctness claim below was actually
run and is real. Every real-device claim (mask alignment on an actual person, hair/
clothing segmentation quality, actual inference milliseconds, actual FPS, mobile
behavior) was **NOT measured in this session** and is reported as exactly that — not
estimated, not inferred from Google's own benchmark, not guessed. That distinction is
the single most important thing in this section; see Steps 13/21/22 of the request that
produced this milestone, which anticipated exactly this split and asked for both parts
to be reported honestly rather than the automated part standing in for the real-device
part.

## Files changed

New: `apps/web/src/lib/live-ar/segmentation.ts` + `segmentation.test.ts`. Modified:
`constants.ts` (cadence default), `performance.ts`+test (segmentation timing stats,
`formatSegmentationDebugText`), `renderer.ts`+test (`drawSegmentationDebugOverlay`),
`useLiveArSession.ts` (loading/cadence/debug-draw wiring), `LiveArStudio.tsx` (toggle
button + status/timing readout), `ai/models/LICENSES.md` (new registry row). Not
touched: `apps/api/*`, `workers/*`, `ai/geometry/*` (Python), any migration —
browser-local only, per this milestone's own architecture constraint.

## MediaPipe package/WASM versions (Step 2)

Installed npm package: `@mediapipe/tasks-vision@1.0.1` (unchanged). WASM fileset: still
CDN-pinned to `tasks-vision@0.10.14` (unchanged — the SAME fileset URL `tracking.ts`
already uses for FaceLandmarker/PoseLandmarker in production). **No version change was
made.** Reasoning (see `segmentation.ts`'s own file docstring): `ImageSegmenter` ships in
the same generic Tasks-Vision WASM bundle as every other vision task; there is no
version-specific reason to expect it to behave differently on the fileset already
proven to work in production for the other two tasks, and the request that produced
this milestone explicitly said not to upgrade MediaPipe unnecessarily. **This reasoning
has not been tested on a real device this session** — if a real device shows a genuine
incompatibility, that would be new evidence contradicting this section, not something
already ruled out.

## Exact segmentation model + license (Step 3)

`selfie_multiclass_256x256`, `float32/latest`, loaded directly as a raw `.tflite` asset
(confirmed via Google's own official web code sample using the identical pattern for a
different segmentation model — see Sources) from
`storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/`.
Apache 2.0, commercial use permitted — already registered in `ai/models/LICENSES.md`
(Milestone 3's row), and a **new row added this milestone** distinguishing this
browser-side, `.tflite`-direct loading path from that row's server-side, `.task`-file,
sandbox-blocked context (see the LICENSES.md diff itself for the exact wording).

## Mask categories (verified, not assumed)

`0=background, 1=hair, 2=body-skin, 3=face-skin, 4=clothes, 5=others` — confirmed against
Google's own Image Segmentation guide (see Sources), encoded once in
`SEGMENTATION_CATEGORY_LABELS` and imported everywhere else that needs it.

## Coordinate/mirroring implementation (Steps 8/9)

The mask is produced at its own native resolution (256x256), not the video's. The debug
overlay draws it scaled up to the video's actual pixel size via plain Canvas 2D
`drawImage` scaling, in the SAME unmirrored coordinate space the video/jewellery/
necklace-debug overlay already share — no independent mirror transform was added; the
existing single CSS mirror on the shared wrapper (`coordinates.ts`) already covers it,
exactly like every other overlay in this file. **Alignment itself (Step 8's actual
front-facing/moving-person check, Step 9's actual left/right-side check) requires a real
camera and has NOT been performed.** The coordinate-space reasoning above is verified by
construction/code-review, not by watching a real mask sit on a real person.

## Segmentation cadence (Steps 6/14)

`SEGMENTATION_INTERVAL_MS_DEFAULT = 500` (2 inferences/sec), in `constants.ts`, fully
configurable via `SegmentationCadenceScheduler`'s constructor. Explicitly documented as
an **uncalibrated starting point** chosen only to be safely slower than Google's own
published worst-case benchmark for this model (217.76ms CPU on a Pixel 6) — not derived
from any measurement of this app. Jewellery tracking/geometry/render continue at the
full RAF rate regardless of this cadence; only segmentation itself is throttled, and a
stale mask is reused between inference runs. **Cadence A/B/C/D comparison (Step 14) was
NOT performed** — that requires the real-device timing data this session cannot produce;
the scheduler is built to make that comparison trivial once real numbers exist.

## Automated tests (Step 18) — real, run this session

23 new frontend tests, all passing:
- `segmentation.test.ts` (16): category label mapping; `toSegmentationResult`'s
  null-on-missing-mask and shape-conversion behavior (hand-built fixtures, same
  convention as `tracking.test.ts` — no real MediaPipe model load, see that file's own
  docstring for why); `SegmentationCadenceScheduler`'s full state cycle (first-frame run,
  cadence gating, stale-mask reuse, failed-run retry-on-cadence, reset); pure
  category→color mapping (`buildSegmentationDebugRgba`), including background
  transparency, distinct colors per category, exact byte-length, and safe fallback on an
  out-of-range category byte.
- `performance.test.ts` (+7): `computeTimingStats` (empty-set, avg/median/min/max,
  even-length median, p95, order-independence) and `PerformanceTracker`'s segmentation
  stats correctly excluding cadence-skipped (null) frames rather than counting them as
  0ms.
- `renderer.test.ts` (+2): `drawSegmentationDebugOverlay`'s exact `drawImage` scaling
  arguments, verified via the existing fake-ctx call-sequence pattern (this project's
  jsdom test environment has no real `getContext("2d")`/`ImageData` implementation —
  verified directly this session, not assumed, which is why no test here touches a real
  canvas).

## Full test count (Step 10 of the final report)

Before M6.3 (end of M6.2): 191 frontend tests. After M6.3: **214** (191 + 23 new). Same
pre-existing flake as every prior milestone in this repo
(`JewelleryCreateForm.test.tsx`'s slug-validation test — fails intermittently under the
full parallel suite, passes 2/2 every time in isolation; unrelated to Live AR, not
touched by this milestone) — no new failures introduced.

## Build result

`npm run build` (Next.js production build): succeeds, all 7 routes compile and
prerender including `/try-on/live`. `npx tsc --noEmit`: clean, no errors.

## Lint result — reported honestly, including what did NOT get fully resolved

Before M6.3: 53 problems (29 errors, 24 warnings), all pre-existing (see M6.2's own
section above). After M6.3: **58 problems (34 errors, 24 warnings)** — a real increase
of +5 errors, zero net new warnings. `next lint` exits 0 either way, matching this
project's existing config (lint does not gate the build).

What the +5 actually are, checked by hand rather than left as a bare number:
- One legitimate `react-hooks/exhaustive-deps` warning (reading
  `segmentationSchedulerRef.current` inside the segmenter-loading effect's cleanup
  function) was caught and fixed directly — the ref is now captured into a local
  variable at the top of the effect and that variable is used in cleanup instead, so
  this milestone nets zero new warnings despite introducing one along the way.
- 2 of the +5 errors are genuinely new instances of already-tolerated, pre-existing rule
  *categories* in this exact file: one `react-hooks/refs` "cannot update ref during
  render" on `showSegmentationDebugRef.current = showSegmentationDebug` (the identical
  pattern `debugEnabledRef`/`debugNeckFractionOverrideRef`/etc. already use, already
  flagged by this same rule before M6.3 touched anything), and one
  `react-hooks/set-state-in-effect` on `setSegmentationStatus("loading")` (the identical
  pattern `setCameraStatus`/`setTrackersStatus`/`setAssetLoading` already use, already
  flagged the same way).
- The remaining ~3 are `react-hooks/refs` "cannot access ref value during render" flags
  on the 3 property-chain arguments passed to the new `formatSegmentationDebugText(...)`
  call (`session.segmentationStatus`, `session.segmentationError`,
  `session.performance.segmentation`).
- Investigating this, the same rule ALSO newly flagged several **pre-existing, unrelated,
  definitely-correct lines** in `LiveArStudio.tsx` this milestone did not touch — most
  tellingly `<canvas ref={session.canvasRef} .../>` (line 262), a plain, correct ref
  prop that has worked since Milestone 5 and is not a bug by any reasonable reading.
  This strongly indicates the underlying ESLint rule (a newer "React Compiler" hooks
  rule) is doing a whole-component analysis that, once it can't fully model one new
  expression, conservatively flags *other*, unrelated `session.*` accesses in the same
  component — not that this milestone introduced 10+ new real defects. This was checked
  by hand (see the file's own diff), not asserted without looking; a deeper root-cause
  fix (e.g. destructuring `session` differently, or filing this as a lint-plugin
  limitation) was judged not worth further time against a proof-of-concept milestone
  whose own stop condition is "wait for review," but is flagged here rather than hidden.

## Real device (Steps 13/21/22) — UPDATE 2026-09-24: now measured

The gaps below were left open when this section was first written (this sandbox has no
camera and could not collect them itself) and have since been filled in from a real
device/browser session, reported back after this milestone shipped:

- Device/browser/OS/camera resolution: not itemized in the report received; the
  qualitative and timing observations below are from a real session, not this sandbox.
- Segmentation inference timing — **n = 31, average ≈ 234.5ms, p95 ≈ 276.5ms,
  min ≈ 199.2ms, max ≈ 288.0ms**, at the ~500ms cadence configured
  (`SEGMENTATION_INTERVAL_MS_DEFAULT`). These are the real numbers M6.4's
  `OCCLUSION_STALE_MASK_THRESHOLD_MS` reasoning is now grounded in (see that constant's
  own comment in constants.ts) — not Google's benchmark, not an estimate.
- Overall live FPS: not separately reported as a number.
- Mask alignment quality: **"aligns reasonably well with the camera image... no
  obvious global coordinate/mirroring displacement was observed."**
- Hair segmentation quality: **"visibly separated."**
- Clothing segmentation quality: **"visible."**
- Face/skin segmentation: **"visible."**
- Memory/lifecycle behavior over a long real session: still not specifically observed.

**Conclusion drawn from this real data**: the mask is suitable for a first occlusion
experiment (M6.4, below) — this is the actual basis M6.4 was approved on, not an
assumption.

## Whether the result was acceptable for M6.4 (Step 19)

**Yes, conditionally accepted** based on the real-device observations above: alignment,
hair separation, and clothing/skin separation were all judged good enough to build a
first occlusion experiment on top of, while explicitly not treating the ~234.5ms average
inference time as acceptable for per-frame use (it isn't, and M6.4 does not attempt
that — see its own section below for how the periodic-cadence-plus-mask-reuse
architecture keeps segmentation off the render loop's critical path).

## Fallback options if real-device performance is unacceptable (Step 15 — documented, not implemented)

1. Reduce segmentation cadence further (raise `SEGMENTATION_INTERVAL_MS_DEFAULT`).
2. Reduce segmentation input size (a smaller model variant, if one exists).
3. Fall back to `PoseLandmarker`'s own built-in binary `outputSegmentationMasks` (already
   loaded, no second model) for a coarser person-silhouette-only occlusion cue, per
   `docs/live-ar-realism-architecture.md` §6's own note on this option.
4. Disable segmentation entirely on detected low-performance devices/browsers.

None of these are implemented in M6.3 — evaluating them without real measurements would
be exactly the "premature optimization" Step 14 warns against.

## Memory/lifecycle (Step 16)

The segmenter is created once per mount (mirroring `createLiveTrackers`'s existing
lifecycle exactly) and disposed (`segmenter.close()`) on unmount, camera-stop, or session
restart, via the same cancelled-flag + cleanup-function pattern already used for the
face/pose trackers. The cadence scheduler is reset alongside it. **Not verified on a real
long-running session** (no camera) — the pattern matches existing, already-relied-upon
code exactly, which is the basis for trusting it, not a live memory-profiler run.

## Known limitations / risks

- Segmentation loads and runs on its cadence for every Live AR session once ready,
  regardless of whether the debug panel is ever opened — deliberate, to get honest
  "always on" timing data (see `useLiveArSession.ts`'s own comment on this choice), but
  worth reconsidering (e.g. gating load behind a dev flag) before this becomes permanent
  rather than a proof of concept.
- The lint delta discussed above.
- Real-world reliability of the category mask (temporal flicker frame-to-frame, false
  classification at hair/clothing boundaries) is completely unknown pending real-device
  testing.

## Commit

See `git log` — "feat(live-ar): add multiclass segmentation proof of concept".

## M6.3 Sources

- [Image segmentation guide — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) — category list, model hosting URL, Pixel 6 CPU/GPU latency benchmark.
- [Image segmenter Web/JS guide — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js) — confirms `modelAssetPath` loads a raw `.tflite` directly (the pattern this milestone's model URL follows) and `outputCategoryMask`/`outputConfidenceMasks` option names.

---

# M6.4 Verification — Segmentation-Aware 2D Necklace Occlusion

**Scope: M6.4, necklace only.** Implements the first real occlusion pipeline: hair (and,
region-aware, clothing) can now draw in front of the necklace instead of the necklace
always rendering on top of everything. **This is explicitly 2D, segmentation-based
occlusion, not 3D depth-aware occlusion** — nothing here reasons about real depth or
distance; it only asks "what category is this pixel classified as" and applies one
documented rule. Earrings, shadows, lighting, materials, WebGL, and generative AI are
all untouched — none of those were in scope and none were added.

## Occlusion architecture

```
CAMERA
  |
BODY SEGMENTATION (M6.3 -- unchanged, still periodic/~500ms, mask reused between updates)
  |
JEWELLERY GEOMETRY (unchanged -- necklace anchor/scale/rotation are byte-identical to before M6.4)
  |
OCCLUSION COMPOSITING (NEW -- occlusion.ts's pure decision + renderer.ts's isolated erase draw)
  |
FINAL CAMERA IMAGE
```

The render loop NEVER blocks waiting for segmentation (Step 3) -- it reads whatever
`SegmentationCadenceScheduler.getLatest()` currently holds (a fresh mask, or one up to
`OCCLUSION_STALE_MASK_THRESHOLD_MS` old) and proceeds immediately. Tracking and geometry
run at the full RAF rate exactly as before; only the segmentation model itself runs on
its own periodic cadence, unchanged from M6.3.

**The documented occlusion rule** (see `occlusion.ts`'s file docstring for the full
physical reasoning): HAIR occludes the necklace anywhere in its rendered region; CLOTHES
occludes only at or above the necklace's own neck-attachment point (a collar can ride up
over the top of a necklace, but a necklace normally rests on top of clothing on the
chest -- this is deliberately NOT the blanket "class=clothes hides everything" rule the
request explicitly warned against); BACKGROUND, BODY-SKIN, FACE-SKIN, and OTHERS never
occlude.

**Compositing technique**: the necklace sprite is drawn onto an isolated OFFSCREEN
canvas (never the main canvas), then erased with `globalCompositeOperation:
"destination-out"` using a scaled-up erase pattern built from the occlusion decision.
This is the structural fix for the exact failure class that broke three earlier
contact-shadow attempts (a compositing-mode change applied directly to the shared main
canvas, masking against everything already drawn there, not just one sprite) --
`destination-out` here can only ever erase from this one offscreen buffer, because
nothing else is ever drawn onto it. See `renderer.ts`'s `drawOccludedJewelleryOverlay`
docstring for the full account.

## Mask coordinate mapping

The necklace's rendered bounding box (`geometry.ts`'s new `computeTransformedBoundingBox`,
extracted from debug.ts's pre-existing, already-tested `finalVisibleBboxPx` logic with no
behavior change) and its neck-attachment Y are converted from canvas/video pixel space
into the segmentation mask's own native resolution via `occlusion.ts`'s
`toMaskSpaceRegion` -- a plain PER-AXIS scale (not a single uniform factor), so a
mask/video aspect-ratio mismatch is still mapped correctly on each axis independently.
This reuses the exact stretch-mapping convention `drawSegmentationDebugOverlay` (M6.3)
already used and that the real-device check reported as showing "no obvious global
coordinate/mirroring displacement." No independent mirroring was added anywhere in this
module -- it works entirely in the same unmirrored space tracking/geometry already use.

## Hair occlusion result

**Automated**: `computeNecklaceOcclusionMask`'s tests prove hair occludes anywhere in the
necklace's region, including well below the attachment point (see occlusion.test.ts).
**Real-device**: not yet re-tested against this specific M6.4 build (see Step 19's visual
test below, still pending your report) — this is the single most important thing to
verify next; M6.4 is not "working" by this project's own standard unless hair visibly
covers the necklace on a real camera, regardless of what the automated tests say.

## Clothing/body occlusion result

**Automated**: tests prove clothing occludes only at/above the attachment point, never
below it (occlusion.test.ts's "clothes occludes only at or above the attachment point"
case), and that skin/others never occlude. **Real-device**: not yet re-tested.

## Background behavior

**Automated**: an all-background region produces zero occlusion (tested explicitly, twice
-- once as its own case, once as the "empty segmentation" case). Background can never
hide the necklace by construction, not by a runtime check that could be bypassed.

## Mask age behavior

`SegmentationCadenceScheduler.getLatestAgeMs()` (new) tracks how old the current mask is,
separately from the cadence timer itself (so a failed inference attempt doesn't reset the
age clock — the age is measured from the last SUCCESSFUL result). `occlusion.ts`'s
`isMaskStale()` compares this against `OCCLUSION_STALE_MASK_THRESHOLD_MS = 2000` (see
constants.ts for the full derivation: ~2.5x the healthy worst-case gap implied by M6.3's
real numbers, 500ms cadence + 276.5ms p95 inference ≈ 777ms). A stale or missing mask
falls back to **no occlusion** — the necklace renders exactly as it did before M6.4 —
never an ancient mask, never a hidden necklace. Exposed in the occlusion debug panel as
"mask age=Nms old" (see Step 15 below).

## Tracking-loss behavior

No new code was needed: occlusion only runs against `overlays[0]` when a necklace overlay
actually exists that frame, and the existing `TrackingStateMachine` already returns no
overlay at all when tracking is LOST (`result.transform === null` → the slot contributes
nothing to `overlays`). During DEGRADED, the coasted transform still gets occlusion
applied, which is the correct behavior — the necklace is still visibly rendering, just
smoothed/held, so it should still be correctly occluded.

## Automated tests (Step 17)

37 new tests, all passing. `occlusion.test.ts` (24): every documented rule case (hair
anywhere, clothes above/below attachment, skin/background/others never occlude), fully
opaque/transparent/partial/mixed regions, out-of-bounds and invalid input handled without
throwing, coordinate conversion including a genuine aspect-ratio mismatch, the
no-mirroring invariant, stale/fresh mask thresholds (including the exact boundary), and
both RGBA builders (erase pattern and debug visualization). `segmentation.test.ts` (+5):
`getLatestAgeMs`'s full behavior including the "doesn't reset on a failed run" case.
`performance.test.ts` (+2): occlusion timing tracked independently of segmentation timing.
`renderer.test.ts` (+2): `drawOccludedJewelleryOverlay`'s exact call sequence and
composite-mode-at-call-time (jewellery draws with normal compositing, the erase step and
only the erase step uses `destination-out`), including the zero-opacity case.
`geometry.test.ts` (+4): the relocated `applyLiveTransformToPoint`/
`computeTransformedBoundingBox` functions, tested directly rather than only indirectly
through debug.ts. Explicitly NOT tested (by design, matching this project's own
established convention — see tracking.test.ts/segmentation.test.ts's docstrings):
tracking LOST/DEGRADED as *occlusion* test cases specifically, since that behavior falls
out of the pre-existing `TrackingStateMachine` with zero new occlusion-specific code (see
"Tracking-loss behavior" above) — there is nothing occlusion-specific to unit-test there
that isn't already covered by tracking-state.test.ts's own existing suite.

## Full test count

Before M6.4 (end of M6.3): 214 frontend tests. After M6.4: **251** (214 + 37 new). Same
pre-existing flake as every prior milestone (`JewelleryCreateForm.test.tsx`, unrelated to
Live AR, passes in isolation) — no new failures.

## Build

`npm run build`: succeeds, all 7 routes compile including `/try-on/live`. `npx tsc
--noEmit`: clean.

## Lint

Before M6.4: 58 problems (34 errors, 24 warnings). After M6.4: **61 problems (37 errors,
24 warnings)** — +3 errors, **0 net new warnings** (one new `react-hooks/exhaustive-deps`
warning was caught and fixed directly, by removing a redundant state read inside the RAF
closure and relying on React's own no-op bailout for a repeated `setState(null)`, instead
of adding the value to the effect's dependency array — which would have torn down and
restarted the whole render loop on every debug-info change). The +3 errors are the same
already-documented, already-tolerated pattern from M6.3's own lint section: one more
`react-hooks/refs` "ref updated during render" on the new `showOcclusionDebugRef.current =
showOcclusionDebug` line (matching `showSegmentationDebugRef`/`debugEnabledRef`/etc.
exactly), and two more "cannot access ref value during render" flags on the two
property-chain arguments passed to the new `formatOcclusionDebugText(...)` call —
structurally identical to M6.3's `formatSegmentationDebugText(...)` collateral, not a new
category of issue. `next lint` exits 0 either way.

## Real-device observations (Steps 19/21)

**Not yet performed against this specific M6.4 build.** Per Step 19 of the request: use
a real camera, select a necklace, enable both "Show segmentation debug" and "Show
occlusion debug," and check hair-away-from-necklace (should stay visible),
hair-crossing-necklace (hair should appear in front), head/body movement (occlusion
should track), fast movement (observe stale-mask fallback), and that disabling both
toggles returns the normal UI. **This is the single most important unresolved item** —
until it's done, M6.4's real-world success is unknown regardless of what the automated
suite says.

## Actual occlusion/compositing timing and FPS

**Not yet measured on a real device for this build.** The debug panel (`formatOcclusionDebugText`,
visible when "Show occlusion debug" is on) reports real `computeTimingStats` numbers
(n/avg/p95) for the compositing step the moment it runs on your device — read it directly
rather than estimating.

## Known failure cases (reasoned, not yet device-confirmed)

- A necklace whose attachment point sits unusually high or low relative to where a real
  collar naturally falls could make the clothing rule look wrong in either direction
  (occluding too much or too little) — the rule is a documented approximation using the
  existing anchor, not a learned or per-garment-calibrated boundary.
- Fast head/body movement during the ~500-777ms window between mask updates could show a
  visibly lagging occlusion boundary before falling back to no-occlusion past the stale
  threshold — exactly what Step 19's test E asks you to observe and report.
- Segmentation misclassification at hair/clothing boundaries (a real, unmeasured
  uncertainty carried over from M6.3) would show up here as incorrect occlusion at that
  boundary, not as a bug in this module's own logic.

## Whether M6.4 is visually convincing

**Cannot be claimed from this session.** Automated tests confirm the decision logic
implements the documented rule correctly and the compositing technique is structurally
sound (isolated buffer, no repeat of the prior shadow-attempt failure mode). Whether hair
actually, visibly appears in front of the necklace on a real person — the one criterion
this milestone's own request says matters more than any test — has not been confirmed.
**M6.4 is not yet confirmed working; do not treat automated-test success as visual
success.**

## What M6.5 would add

Per the stop condition: nothing further has been started. M6.5 (contact shadows) is
explicitly deferred and was not touched — no shadow, blur, lighting, or material code was
added in this milestone. M6.5 should only begin after the real-device visual test above
is actually performed and reported.

## Commit

See `git log` — "feat(live-ar): add segmentation-aware 2D necklace occlusion (M6.4)".

---

# M6.4 Real-Device Review — Debugging Findings (2026-09-24)

**Status: M6.4 NOT FIXED (unconfirmed).** Per the real-device review that prompted this
section: "Only state M6.4 FIXED if the real camera visibly demonstrates hair in front of
the necklace." That has not happened — this sandbox has no camera and cannot perform
that check. What follows is everything that COULD be determined without one, plus new
diagnostic tooling for the next real-device pass. Do not read anything below as a claim
of success.

## 1. Root cause of the visual failure

**Not conclusively identified.** What was ruled out, with evidence: the core occlusion
decision logic and the pixel compositor are NOT the bug (see §3/§4/§5 below — proven with
real Canvas 2D pixel operations, not just abstract booleans). What remains genuinely
unknown without a camera: whether the real test shots had hair actually classified as
overlapping the necklace's real screen position at all (a segmentation coverage/
resolution question) — §8's new class-distribution readout is built specifically to
answer this on the next real-device pass, and is the single most informative next
measurement.

## 2. Is segmentation itself correct?

Real-device observation (already reported): hair/face-skin/clothing regions are
"visibly segmented" and alignment looks reasonable — unchanged from M6.3, not touched
by this debugging pass. Class index mapping (0-5) re-verified against the same cited
Google documentation, unchanged.

## 3. Is the final occlusion mask correct?

**Yes, proven with real pixel data, not just unit-tested booleans.** A new test file,
`occlusion-pixel.test.ts`, uses the real `canvas` npm package (a genuine C-backed Canvas
2D implementation, added as a devDependency, its `destination-out` semantics confirmed
directly against the browser spec before relying on it: erasing a solid blue square's
left half with a solid black `destination-out` fill produces exactly `[0,0,0,0]` there
and leaves `[0,0,255,255]` untouched on the right) to run `computeNecklaceOcclusionMask`
→ `buildOcclusionEraseRgba` → `drawOccludedJewelleryOverlay` — the exact production
functions — against a synthetic scene, then reads back real output pixels.

**Result**: a hair band crossing the middle of a synthetic necklace sprite is fully
erased (`[0,0,0,0]`) at the sample point under the hair, while the necklace's own gold
color remains fully opaque (`[212,175,55,255]`) at a sample point below the attachment
line where clothes should not occlude it. This holds under both a trivial scale=1/
rotation=0 transform AND a realistic scale=0.3/rotation=12° transform (using the real
`computeTransformedBoundingBox` from geometry.ts to derive the footprint, not a
hand-computed one) — see "real pixel-level compositor under a REALISTIC scaled +
rotated transform" in the test file.

**One real, minor finding, not a functional bug**: sampling exactly at the necklace's
own clip-region boundary (1px inset from a corner) shows partial erasure (~63% erased,
not 100%) when the whole mask is occluding — standard image-smoothing anti-aliasing from
scaling a low-resolution (e.g. 20×20 or 256×256) mask up to the video's resolution. This
only affects a thin band at the region's own edge, not its interior, and does not affect
the realistic hair-crossing scenario above (documented as its own explicit test case,
not swept under the rug).

## 4. Is the pixel compositor correct?

**Yes** — same evidence as §3. `destination-out` is applied only on an isolated
offscreen canvas containing nothing but the jewellery sprite (verified directly: the
composite-mode-at-call-time is recorded in `renderer.test.ts` and shown to be
`"source-over"` for the sprite draw and `"destination-out"` ONLY for the erase draw,
never touching the main canvas or the camera layer).

## 5. Synthetic compositor test result

**Passed — 8/8 in `occlusion-pixel.test.ts`** (after fixing the test's own incorrect
boundary-anti-aliasing expectation, not the production code — see §3). Confirms: THE
COMPOSITOR IS NOT WRONG, per the real-device review's own stated criterion for that
conclusion.

## 6. Real-camera hair-over-necklace result

**Not re-tested by this session (no camera).** This is the one thing that actually
answers whether M6.4 works. New tools built specifically to make the NEXT real test more
diagnostic than a screenshot alone (§8, §14): the "Show occlusion debug" panel now also
renders a standalone white/black final-visibility-mask thumbnail (Step 2's exact ask)
and a live class-distribution percentage readout for the necklace's own region (Step 7/8).

## 7. Mask age

Already reported in one real screenshot: "mask age ≈ 375ms" — comfortably under the
2000ms stale threshold, so staleness was not the blocker in that observation. `mask
age`/staleness/tracking-state remain in the debug text readout, unchanged.

## 8. Actual class distribution inside the necklace region

**Not yet measured on a real device — this is new capability, not a retroactive
number.** `occlusion.ts`'s new `computeCategoryDistribution` computes real
hair/skin/clothes/background/others percentages within exactly the necklace's own mapped
region, and `formatCategoryDistribution` renders it in the occlusion debug panel (e.g.
"Necklace region (142px): hair=18.2% skin=42.1% clothes=31.5% background=0.0%
others=8.2%"). **This is the single most important number to capture on the next
real-device test**: if `hairPct` is 0 while hair visibly crosses the necklace on camera,
the bug is upstream (segmentation/region mapping, contradicting §3's pixel-level proof
somehow); if `hairPct` is meaningfully positive but the necklace still isn't visibly
occluded on screen, the bug is downstream of this module (a wiring/display issue this
pixel test doesn't cover).

## 9. Exact rendering pipeline (as implemented, traced end to end)

```
1. video drawn onto the MAIN canvas          (renderLiveFrame, unchanged since M6.1)
2. necklace transform computed                (geometry.ts, unchanged since M6.4's own commit)
3. necklace footprint (canvas space) derived   (computeTransformedBoundingBox)
4. footprint + attachment Y -> mask space       (toMaskSpaceRegion, per-axis scale)
5. per-pixel occlusion decision computed        (computeNecklaceOcclusionMask, pure)
6. erase RGBA built from that decision          (buildOcclusionEraseRgba, pure)
7. erase RGBA written into occlusionEraseCanvasRef (putImageData, native mask resolution)
8. necklace drawn onto occlusionScratchCanvasRef (drawJewelleryOverlay, ISOLATED offscreen canvas)
9. destination-out erase applied to THAT SAME offscreen canvas only (drawOccludedJewelleryOverlay)
10. occlusionScratchCanvasRef drawn onto the MAIN canvas          (plain ctx.drawImage, source-over)
```

Canvas identity at each step, to directly answer Step 4's "no possibility that canvas A
is modified but canvas B is displayed" concern: exactly ONE offscreen canvas
(`occlusionScratchCanvasRef.current`) is ever modified by the erase (step 9), and that
SAME canvas object is what step 10 draws onto the main canvas — confirmed by reading the
code directly (`occludedNecklaceCanvas = scratchCanvas` is set to the identical object
`drawOccludedJewelleryOverlay` just wrote into, then `ctx.drawImage(occludedNecklaceCanvas, 0, 0)`
draws that exact object). There is no second buffer this could silently diverge from.

## 10. Tracking breakdown

**Newly instrumented, not yet measured with this instrumentation on a real device.**
`tracking.ts`'s `detectFrameWithTiming` (replacing the former `detectFrame` — folded the
timing in rather than keeping two near-duplicate functions) now times FaceLandmarker and
PoseLandmarker separately; `formatTrackingBreakdownText` renders it in the main
performance panel (e.g. "Tracking breakdown -- Face: n=40 avg=Xms p95=Yms / Pose: n=40
avg=Xms p95=Yms"). The previously reported combined "Tracking ≈ 90-140ms" figures are
real but undifferentiated between the two models until re-measured with this build.

## 11. Segmentation timing

Unchanged from M6.3's already-reported real numbers: n=31, avg≈234.5ms, p95≈276.5ms,
min≈199.2ms, max≈288.0ms, at the ~500ms cadence. Confirmed NOT running every frame (Step
13) — the cadence scheduler is untouched by this debugging pass.

## 12. Compositing timing

**Not yet measured on a real device with the actual occlusion pipeline running.**
`session.performance.occlusion` (TimingStats, same shape as segmentation's) reports real
n/avg/p95/min/max the moment occlusion actually runs on your device — read directly from
the debug panel rather than estimated. Expected to be small (comparable to render's
already-reported 0.8-3.1ms, since it's a handful of small-canvas pixel operations), but
that is an expectation, not a claim.

## 13. Actual FPS

Already reported, real, not fabricated: 3-7 FPS across four real tests, with tracking +
geometry dominating total frame time (89.8-138.6ms) and render itself small (0.8-3.1ms).
**Not claimed production-ready.** Per Step 15, this is a separate track from occlusion
correctness and was not touched or optimized in this debugging pass — only instrumented
further (§10) so the next measurement can say which model actually dominates "tracking."

## 14. Tests added

19 new tests this debugging pass, all passing: `buildFinalVisibilityMaskRgba` (3),
`computeCategoryDistribution`/`formatCategoryDistribution` (4),
`occlusion-pixel.test.ts`'s real Canvas 2D synthetic compositor tests (8, per Step 6),
face/pose detection timing split (2), `formatTrackingBreakdownText` (2).

## 15. Total tests

251 (end of M6.4's original commit) → **270**. Confirmed passing together in a clean run
(269 passed, 1 pre-existing unrelated flake — `JewelleryCreateForm.test.tsx`, confirmed
passing in isolation many times across this whole session). One new, environment-load-
dependent flake was found and is disclosed rather than hidden: `occlusion-pixel.test.ts`
(the new real-`canvas`-backed test file) can occasionally time out or have its whole
suite skipped when the full 29-file test suite runs under heavy parallel contention on
this machine — the native module's one-time initialization cost scales with how many
worker threads are contending at once (observed directly: instant alone, ~7s at
18 parallel files, 32-67s+ at 29). A `beforeAll` warmup with a generous timeout (90s)
was added, and the file passes reliably (confirmed repeatedly) when run alone or as part
of the 18-file `src/lib/live-ar` directory — this is a test-infrastructure/machine-load
characteristic of adding a real native dependency, not a defect in the code it tests.

## 16. Build

`npm run build`: succeeds, all 7 routes compile including `/try-on/live`. `npx tsc
--noEmit`: clean.

## 17. Lint

Before this debugging pass (M6.4's own commit): 61 problems (37 errors, 24 warnings).
After: **67 problems (43 errors, 24 warnings)** — +6 errors, 0 net new warnings. Checked
by hand: every new error is another instance of the exact already-documented pattern
from M6.3/M6.4's own lint sections (a `react-hooks/refs` "ref updated during render" per
new `useRef`-backed flag, and "cannot access ref value during render" per new
property-chain argument passed to a new formatter function in JSX) — not a new category
of issue. `next lint` exits 0 either way.

## 18. Commit

See the commit immediately following this one in `git log` (this debugging pass is
committed separately from M6.4's original implementation commit, per this project's
one-focused-change-per-commit convention).

## New diagnostic tools available for the next real-device test

- **"Show occlusion debug" panel** now also shows: a standalone white/black final
  jewellery-visibility thumbnail (top-right picture-in-picture, Step 2), and a live
  hair/skin/clothes/background/others percentage breakdown for the necklace's own region
  (Step 7/8).
- **"Show performance" panel** now also shows a Face/Pose detection timing breakdown line
  (Step 10/12).
- Recommended next real-device test, in order: (1) select a necklace, enable both "Show
  segmentation debug" and "Show occlusion debug"; (2) cross a visible hair strand over
  the necklace and read the new "Necklace region: hair=N%" line — if N is meaningfully
  above 0, segmentation IS detecting hair there; (3) compare the white/black thumbnail
  against what's actually happening on the main camera view at that same moment; (4)
  report back what those two specific readouts showed, not just whether the necklace
  visually changed.

---

# M6.4 Controlled Real-Device Validation — Diagnostics Added (2026-09-24, round 2)

**Status: unchanged — M6.4 NOT FIXED (unconfirmed).** No architecture was touched this
round (segmentation pipeline, cadence, necklace geometry, offscreen buffer, compositor,
`destination-out` approach, mask-age handling, and tracking lifecycle are all
byte-identical to the previous commit) — this round is diagnostics only, per the
controlled-validation request's own Step 1.

## 1. Files changed

`occlusion.ts` (+`hasHairOverlap`, `computeHairOverlapReport`, `formatHairOverlapReport`,
raw per-category pixel counts on `CategoryDistribution`), `segmentation.ts`
(+`getLatestCapturedAtMs`), `useLiveArSession.ts` (wires the above into
`occlusionDebugInfo`), `LiveArStudio.tsx` (renders the new readouts + a cleanup: the
segmentation-timestamp value is now read once into a local `maskCapturedAtMs` instead of
twice via the same optional-chain in JSX). `occlusion.test.ts`, `occlusion-pixel.test.ts`,
`segmentation.test.ts` gained new tests (below). No backend/geometry/compositor files
were modified.

## 2-7. Exact diagnostic values

**Not measured on a real device this round** (still no camera in this sandbox) — these
are the new fields now available for you to read directly off the debug panel on your
next test, exactly as requested, rather than a number I could produce myself:

- Necklace region pixel count → `distribution.totalPixels`
- Hair pixel count → `distribution.hairCount` (a raw count, not back-derived from the
  percentage)
- Hair / body-skin / face-skin / clothes / background / others percentage →
  `distribution.hairPct` etc. (unchanged from the previous round, now sitting alongside
  the matching raw counts)
- Final jewellery visible percentage → `hairOverlap.finalVisiblePct` — computed from the
  ACTUAL occlusion mask applied that frame, scoped correctly to just the necklace's own
  region (an early draft of this function averaged over the WHOLE mask array by mistake,
  which would have silently understated occlusion since the necklace region is a small
  fraction of the full mask — caught and fixed before this was tested at all, see the
  commit diff)
- Mask age → `maskAgeMs` (unchanged)
- Segmentation timestamp → `maskCapturedAtMs`, new (session-relative, not wall-clock —
  every timing value in this codebase is `performance.now()`-relative)

## 8. Class distribution

Same mechanism as the previous round (`computeCategoryDistribution`), now also exposing
raw counts per category, not just percentages, per this round's explicit "do not
estimate these numbers" instruction.

## 9. HAIR/NECKLACE OVERLAP diagnostic (Step 4)

New, exact format as requested:
`HAIR/NECKLACE OVERLAP: YES / Hair in necklace region: 23.7% / Final jewellery visibility: 82.6%`
(`formatHairOverlapReport`). `hasHairOverlap` is a plain, honest threshold — true iff at
least one real mask pixel within the necklace's region was classified as hair (not a
fabricated confidence score).

## 10. Coordinate mapping verification (Step 6)

Re-verified with an explicit new test: the video's four corners and center each map to
the mask's own corresponding corner/center proportionally (`toMaskSpaceRegion`'s existing
per-axis scale, now tested against this specific "four corners + center" checklist
rather than only the aspect-ratio-mismatch case from the previous round). No offset or
correction term exists anywhere in this function — confirmed by reading it, not assumed.

## 11. Whether the final occlusion mask is correct

Unchanged from the previous round's finding: **yes**, proven at the pixel level via
`occlusion-pixel.test.ts` (still present, still passing, per Step 17's "the existing
pixel-level synthetic compositor test must remain"). This round adds one more real-pixel
case: a sprite with its OWN transparent hole (mimicking a real ring/bangle asset) stays
transparent under a fully-occluding erase mask rather than producing an inconsistent
result — `destination-out` correctly respects the sprite's own alpha, not just a solid
rectangle.

## 12. Whether the compositor is unchanged

**Yes — verified by diff, not just by claim.** `renderer.ts`'s `drawOccludedJewelleryOverlay`,
`occlusion.ts`'s `computeNecklaceOcclusionMask`/`buildOcclusionEraseRgba`/
`toMaskSpaceRegion`, and the destination-out compositing order in `useLiveArSession.ts`
were not touched this round; `git diff` against the previous commit for those three
files is empty except for added (never modified) functions.

## 13. Automated test results

14 new tests this round, all passing: hair-overlap YES/NO/partial/degenerate cases (5),
`formatHairOverlapReport` (2), raw category counts (1), four-corners-and-center
coordinate mapping (1), `getLatestCapturedAtMs`'s full lifecycle (4), transparent
jewellery pixels under a real Canvas 2D erase (1). All previously-existing tests,
including the Step 6 synthetic compositor test, still pass unchanged.

## 14. Full test count

`src/lib/live-ar` alone: **229 → 243** (exact, reproducible both before and after this
round).

## 15. Build result

`npm run build`: succeeds, all 7 routes including `/try-on/live`. `npx tsc --noEmit`:
clean.

## 16. Lint result

Before this round: 67 problems (43 errors, 24 warnings). After: 77 (53 errors, 24
warnings) immediately after wiring the new fields into JSX — then reduced to **71 (47
errors, 24 warnings)** after one genuine cleanup (reading `maskCapturedAtMs` once into a
local variable instead of twice via the same optional chain in JSX, which is better code
regardless of lint, not a workaround). The remaining +4 versus the pre-round baseline is
the same already-documented `react-hooks/refs` collateral pattern from every prior
round's lint section — checked by hand again this round, not assumed. 0 net new
warnings. `next lint` exits 0 either way.

## 17. Commit hash

See the commit immediately following this one in `git log`.

## Exact instructions for the real-device test (Step 18)

1. Open `/try-on/live`, select a necklace with clearly visible hair nearby (long hair
   works best for this test).
2. Enable **both** "Show segmentation debug" and "Show occlusion debug".
3. **Control condition**: keep hair visibly away from the necklace for a few seconds.
   Read the bottom-right panel — expect `HAIR/NECKLACE OVERLAP: NO`, `Hair in necklace
   region: 0.0%` (or very close to it), and the necklace fully visible.
4. **Primary acceptance test**: deliberately move a visible section of hair across the
   necklace and hold it there for 2-3 seconds. Read the same panel — expect
   `HAIR/NECKLACE OVERLAP: YES` and a nonzero hair percentage. **Then look at the actual
   camera image**: do the corresponding necklace pixels visibly disappear behind the
   hair? This is the one thing that determines success, not the diagnostic numbers by
   themselves.
5. Move the hair away again — the previously hidden necklace pixels should return, with
   no permanent change to the jewellery.
6. Move your head left/right and your body slightly — the white/black thumbnail
   (top-right) and the hair% readout should stay spatially aligned with where your hair
   actually is, not drift or freeze.
7. Report back, specifically: (a) what `HAIR/NECKLACE OVERLAP` and the hair percentage
   showed at each step, (b) whether the necklace visibly changed when hair crossed it,
   and (c) if it did NOT change even with a nonzero hair percentage, a screenshot of the
   white/black thumbnail at that moment — that would point the investigation at
   compositing/display (Step 15/16) rather than segmentation (Step 14).

**Do not read anything above as "M6.4 fixed."** That determination is yours to make from
step 4 above, on a real device — not from any test or diagnostic number in this
document.

---

# M6.4 Occlusion-Footprint Correction — Bounding Box vs. Actual Jewellery Alpha (2026-09-24, round 3)

**Status: still unconfirmed on a real device — CODE VERIFIED only, per this round's own
explicit "do not declare success from unit tests" instruction.** This round fixes a real,
user-diagnosed root cause (below) with real pixel-level test evidence, but has not been
re-tested on an actual camera.

## 1. Root cause

The real-camera diagnostic (previous round) reported ~24.7% hair "in the necklace
region" while hair visually sat mostly *beside* the necklace, not over it. Root cause,
confirmed by tracing the code (not assumed): `occlusion.ts`'s `region` (from
`computeTransformedBoundingBox`) is the necklace's rectangular **bounding box** — the
tightest axis-aligned rectangle containing the sprite's non-transparent pixels. A
bounding box necessarily also contains transparent area (the empty space around a chain,
gaps between links, the negative space around a pendant). Hair sitting in that
transparent-but-in-bounding-box area was being counted as "hair in the necklace region"
even though no real gold pixel was there. The fix scopes every occlusion decision to the
jewellery's own real, per-pixel alpha, not its rectangle.

## 2. Current (pre-fix) bounding-box behavior — traced, not assumed

- `asset-cache.ts`'s `computeAlphaBoundingBox` scans the FULL alpha channel once, at
  load time, but only **keeps the bounding box** (4 numbers) — the per-pixel alpha
  buffer itself is discarded immediately after (confirmed by reading the function: it
  returns `[left, top, right, bottom]`, nothing else).
- `geometry.ts`'s `computeTransformedBoundingBox` transforms that SAME rectangle's 4
  corners through the live transform and takes their new bounding box — still a
  rectangle, never the sprite's real silhouette.
- `occlusion.ts`'s `computeNecklaceOcclusionMask`/`computeCategoryDistribution` (both
  pre-existing) scan category data within that rectangle. This is exactly "hair
  somewhere inside the jewellery bounding box," not "hair over a real jewellery pixel"
  — the bug.
- The `<img>` element itself (loaded once, cached by `loadJewelleryAssetTexture`) is
  never discarded — its real pixels are still available to draw from at any time. Fixing
  this did not require re-fetching or re-decoding anything.

## 3. Actual alpha-mask implementation

`useLiveArSession.ts`'s render loop now renders the jewellery's own alpha into a small
LOCAL canvas sized to its own on-screen bounding box (never the full video — Step
12/13's "only transform/composite the required region"), using `renderer.ts`'s existing
`drawJewelleryOverlay` at full opacity — the exact same draw call used for the real
sprite, just onto an offscreen buffer whose top-left is shifted to (0,0). Reading that
canvas's alpha channel gives the sprite's real, transformed, per-pixel silhouette —
continuous 0-255 values preserved (not force-flattened to binary), with a configurable
threshold (`DEFAULT_JEWELLERY_ALPHA_THRESHOLD = 10`, matching `asset-cache.ts`'s own
`alpha > 0` convention, loosened slightly to tolerate anti-aliased edges) applied only at
the point of deciding "is this a real jewellery pixel."

## 4. Transform path — one source of truth (Step 3/4)

Both the visible jewellery and its alpha silhouette are drawn by the **same**
`drawJewelleryOverlay` function, given the **same** `LiveTransform` (only the anchor is
shifted by a constant offset to re-origin it onto the small local canvas — scale,
rotation, mirroring, and source anchor are identical). There is no second, independently
maintained transform for the alpha mask that could drift from the real one — confirmed
directly by the pixel-level "alignment under transform" tests (§10 below), which reuse
`computeTransformedBoundingBox` from geometry.ts, not a re-derived one.

## 5. Coordinate mapping

New pure function `computeAlphaDownscaleSourceRect` (occlusion.ts) computes exactly
which fractional sub-rectangle of the local (video-resolution) alpha canvas corresponds
to the clipped mask-space window `computeNecklaceOcclusionMask` itself scans — a single
`drawImage` downscale, never a second transform, and correctly handles the case where the
bounding box is itself partially clipped by the mask/frame edge (verified by a dedicated
test, not assumed). Also extracted `clipRegionToMask` as ONE shared implementation of the
floor/ceil/clamp window logic that had been separately duplicated in five different
functions in this file before this round — a real, verified-behavior-preserving
refactor, not just new code.

## 6. Hair intersection logic

`applyJewelleryAlphaToOcclusionMask` (new): takes the EXISTING category-rule decision
(`computeNecklaceOcclusionMask`, unchanged) and ANDs it against the real alpha buffer —
can only ever REMOVE occlusion the category rule proposed, never add any. Hair occludes
only where BOTH conditions hold: category=hair AND real jewellery alpha present.

## 7. Clothing intersection logic

Same AND-with-alpha treatment, with the pre-existing attachment-line safety rule fully
preserved and unchanged (clothing still only occludes at/above the neck attachment
point) — confirmed by a dedicated test where clothing covers the jewellery both above
and below the attachment line: only the above-the-line portion occludes, regardless of
alpha being present on both sides.

## 8. Skin / background / others

Unchanged. Both still tested directly against the alpha-present jewellery footprint
(not just the bounding box) to confirm they still never occlude even when a real
jewellery pixel is present there.

## 9. New diagnostics (Step 9/10)

- `computeJewelleryAlphaOcclusionReport`: `jewelleryPixelCount` (the actual footprint,
  never the bounding box), `hairOverJewelleryPixelCount`/`Pct`,
  `clothesOverJewelleryPixelCount`/`Pct` (raw, NOT restricted to the attachment rule —
  a real device can distinguish "no clothing detected" from "clothing detected but
  correctly not occluding"), `finalVisiblePixelCount`/`Pct`.
- `formatJewelleryAlphaOcclusionReport`: renders the OLD bounding-box hair% next to the
  NEW alpha-scoped metrics side by side, specifically so the gap this round fixes stays
  visible rather than silently replaced.
- `buildJewelleryAlphaDebugRgba`: the GREEN/RED/BLUE/BLACK visualization, built from the
  exact `categoryData`/`jewelleryAlphaAtRegion` the compositor used this frame — wired
  into a new standalone picture-in-picture panel (`jewelleryAlphaDebugCanvasRef`),
  alongside the existing white/black final-visibility one.
- All shown in the "Show occlusion debug" panel now.

## 10. Automated tests

37 new tests this round: the full `applyJewelleryAlphaToOcclusionMask` rule-x-alpha
matrix (hair inside-bbox-but-outside-alpha, exact overlap, partial overlap, full
overlap, all-transparent, anti-aliased threshold, clothing above/below attachment,
background/skin never occlude, pure-AND-never-OR), `computeJewelleryAlphaOcclusionReport`
(correct denominator, the exact real-device scenario, clothing independent of the
attachment rule), `buildJewelleryAlphaDebugRgba` (all four colors),
`clipRegionToMask`/`computeAlphaDownscaleSourceRect` (pure coordinate math, including a
genuine per-axis-scale-mismatch case), and — the one that matters most for Step 12's
cases 7-10 — **four real Canvas 2D pixel tests in `occlusion-pixel.test.ts`** reproducing
the exact production alpha-rendering pipeline with an intentionally ASYMMETRIC sprite
(opaque only in its own top-left quadrant, so a misaligned rotation would visibly move
the wrong corner) under scale, 90° rotation, translation, and all three combined. All
four passed, including the rotation case — real evidence the alignment holds, not an
assumption.

## 11. TypeScript / build

`npx tsc --noEmit`: clean throughout every incremental change this round. `npm run
build`: succeeds, all 7 routes including `/try-on/live`.

## 12. Performance cost

**Instrumented (`alphaMaskMs`, tracked independently of `occlusionMs`), not yet measured
on a real device.** Per Step 12/13's "if the alpha mask can be cached... prefer that; do
not run unnecessary full-resolution work" -- deliberately NOT attempted this round:
caching would need real evidence it's needed first (this project's own established
discipline — measure before optimizing), and the render already only touches the
jewellery's own small on-screen bounding box, never the full video, which is the
optimization Step 13 asked for explicitly. A cache would also need invalidating on
essentially every frame anyway, since scale/rotation change continuously with tracking
— not an obviously free win without a real number to justify the added complexity.

## 13. Full test count

`src/lib/live-ar`: 268 → **275**.

## 14. Lint

Before this round: 71 problems (47 errors, 24 warnings). After: **79 (55 errors, 24
warnings)** — +8 errors, 0 net new warnings. Checked by hand: the same already-documented
`react-hooks/refs` collateral pattern from every prior round (new property-chain reads
in the new debug JSX), not a new category.

## 15. Commit hash

See the commit immediately following this one in `git log`.

## 16. Exact real-device test instructions

1. Open `/try-on/live`, select a necklace, enable **both** "Show segmentation debug" and
   "Show occlusion debug."
2. **Test A (control)**: keep hair clearly beside, not over, the necklace. Read the
   amber "Actual jewellery footprint" line — expect `hair-over-jewellery` near 0%, even
   if the OLD "bounding box: hair=" number is nonzero (that's the bug this round fixes,
   now visible side by side).
3. **Test B (primary acceptance test)**: move a visible lock of hair directly across
   the gold necklace, hold 2-3 seconds. Expect `hair-over-jewellery` > 0%, and — the
   thing that actually matters — **look at the real camera output**: do the exact
   overlapping gold pixels disappear, with hair still visible and the rest of the
   necklace still visible?
4. **Test C**: move the hair away — expect the percentage to fall back toward 0% and the
   jewellery to fully return, with no permanent change.
5. **Tests D/E**: move your head and body — occlusion should track with the hair, not
   drift or stay screen-fixed. Also glance at the new GREEN/RED/BLUE/BLACK thumbnail —
   it should visibly outline the real necklace shape (green), not a rectangle.
6. Report back: the exact hair-over-jewellery percentages at each step, whether the
   real camera output visibly changed in step 3, and if it didn't change despite a
   nonzero percentage, a screenshot of the GREEN/RED/BLUE/BLACK thumbnail at that moment.

**CODE VERIFIED, not REAL DEVICE VERIFIED.** Do not read this section as "M6.4 complete"
— that determination is still yours to make on an actual camera.

## 17. M6.4 real-device verification prep (2026-09-24, Step 1/2 of the audit request)

**Step 1 — runtime path traced from `b4b0ec2`, confirmed from code (not assumed):**
see the chat report delivered alongside this commit for the full stage-by-stage trace
(camera → tracking → segmentation → geometry/transform → visible render → jewellery
alpha footprint → mask mapping → occlusion decision → isolated buffer →
`destination-out` → final composite), each stage naming its exact file/function.

**Step 2 — debug UI audit against the required checklist (A-I):** items A-H were
already exposed via `formatJewelleryAlphaOcclusionReport` (A/B/C/D/E, amber line),
`formatOcclusionDebugText` (F/H, mask age + tracking), and the `maskCapturedAtMs` line
(G). **Item I ("whether occlusion is currently active") was genuinely absent** —
confirmed by grep, zero matches for any active/inactive flag anywhere in the render
loop or UI. Fixed this round:

- Added `occlusionActive: boolean` to `UseLiveArSessionResult["occlusionDebugInfo"]`
  (`useLiveArSession.ts`), set to `occludedNecklaceCanvas !== null` — the literal
  question of whether the erase/compositing path actually ran this frame, read off the
  same gate the render loop itself uses, never inferred separately by the UI.
- `formatOcclusionDebugText` now leads with an explicit `ACTIVE`/`INACTIVE` word as the
  first thing on the occlusion debug panel's first line, rather than requiring the
  reader to infer activity from the mask-age/staleness text.

**Also found and fixed while auditing Step 4's "verify the debug image is generated
from the EXACT masks the compositor used" requirement:** `buildJewelleryAlphaDebugRgba`
was independently re-deriving the attachment-line occlusion rule instead of consuming
the real `occlusionMask` the compositor actually applied — a latent drift risk, not a
currently-observable bug. Refactored to take the real `refinedOcclusionMask` as a
direct parameter; the one production call site and all 5 test call sites in
`occlusion.test.ts` were updated to match.

These are consistency/completeness fixes made *while* inspecting the code per Step 1's
instruction, not new functionality and not a claim that M6.4 works on a real camera.
`npx tsc --noEmit`, `npx vitest run src/lib/live-ar` (275/275 passing, up from 275 — no
count change, only signature/argument fixes), lint (no new problems beyond the
already-documented `react-hooks/refs` collateral, verified by diffing against the
`b4b0ec2` baseline), and `npm run build` all pass. **Still CODE VERIFIED only.** Steps
3-9 (the real-camera tests) and Step 10 (the final report) are the user's to perform —
not started, not predicted here.

## 18. M6.5 — realistic jewellery wearing / contact rendering

### Algorithm chosen (Step 5)

Considered: (A) mesh-based 2D deformation, (B) piecewise-affine strips, (C) full Canvas
mesh warp, (D) WebGL vertex deformation, (E) cylindrical projection. **Chosen: a
simplified (B)** — the jewellery sprite is sliced into `NECKLACE_CURVATURE_STRIP_COUNT`
(20) vertical strips; each is drawn with its own rigid vertical offset, forming a
shallow parabolic bow across the piece's width. No per-strip stretching/resampling
(Step 11: no fake-warp tricks). Rejected: (D)/(E) need WebGL or per-pixel resampling,
neither of which this milestone's Canvas-2D-only, no-architecture-redesign constraint
permits; (A)/(C) are strictly more general than this problem (a single top-contour bow)
needs. See `jewellery-deformation.ts`'s file docstring for the full reasoning.

### Architecture (Step 13) — new modules, existing ones extended, nothing replaced

- `jewellery-attachment.ts` (new): resolves a neck item's attachment class
  (choker/necklace/haaram) from its catalogue category slug + measured asset aspect
  ratio, and the curvature/length-multiplier parameters that follow from it.
- `jewellery-deformation.ts` (new): `computeJewelleryStrips` — pure, asset-geometry-only
  (never per-frame), producing the strip plan `renderer.ts` draws.
- `renderer.ts`: `drawJewelleryOverlay` gained an **optional** trailing `strips` param
  (every pre-M6.5 call site/test is unaffected — see renderer.test.ts's new "falls back
  to the single drawImage call" test). `drawOccludedJewelleryOverlay` forwards it to the
  SAME internal call, so the visible sprite, the occluded-compositor sprite, and
  `useLiveArSession.ts`'s own alpha-footprint local-canvas render all go through one
  function and therefore can never disagree about the curved shape — the identical
  "one source of truth for the transform" discipline M6.4's bounding-box fix
  established, now extended to cover curvature.
- `asset-cache.ts`: `computeGeometry`/`loadJewelleryAssetTexture` gained an explicit
  `physicalWidthMm` parameter (Step 6), activating `geometry.ts`'s `computeScale`
  physical-dimension branch, which existed since Milestone 4/5 but was fed `null` on
  every Live AR call until now.
- `useLiveArSession.ts` / `LiveArStudio.tsx`: thread each neck item's own
  `category.slug` + `physical_width_mm` from its already-fetched `JewelleryResponse`
  into the above, and resolve/cache the attachment model + strip plan once per loaded
  asset (never per frame — see `LoadedJewelleryTexture`/`resolveLoadedTexture`).
  `geometry.ts`'s existing `necklaceLength` parameter (present but always `null` before
  this milestone — see `NECKLACE_LENGTH_OFFSET_MULTIPLIER`'s own history) is now
  actually fed each item's resolved length key, with the hook's own `necklaceLength`
  prop kept as a rare manual override.
- Segmentation/occlusion (M6.3/M6.4), tracking, smoothing, and the neck reference frame
  itself (Steps 2/4's "do not replace the existing architecture") are **unchanged** —
  curvature composes with occlusion by construction (same draw function), not by a new
  interaction being hand-written.

### Asset audit (Step 1)

**Cannot be run from this sandbox**: the catalogue's real rows/assets live in this
project's own Postgres/MinIO, which this sandbox cannot reach (`localhost:5432`
connection refused; no Docker daemon). `scripts/audit_jewellery_assets.py` is written,
reviewed, and ready — run `python scripts/audit_jewellery_assets.py` wherever the
database and object storage ARE reachable (the same native-process convention as
`scripts/seed_admin.py`) to get real per-item measurements (pixel dimensions, alpha
bbox, aspect ratio, anchor/attachment metadata, physical dimensions populated-or-not,
left/right alpha symmetry).

What IS knowable from the schema alone, with certainty, without running it: **every
catalogue asset is a single flat 2D RGBA PNG** — `db/models/jewellery_asset.py` has
exactly one image per asset row and no depth-layer/mesh/3D field of any kind. No amount
of geometry work changes that; see Step 16 below.

### Real-device test protocol (Step 9) — for you to run, not predicted here

1. Open `/try-on/live`, select a **choker-shaped** item, a **medium necklace**, and (if
   catalogued) a **haaram**, one at a time. Confirm each visibly bows slightly at the
   top rather than sitting as a flat rectangle — the effect is SUBTLE by design (Step
   11: no exaggerated fake curve), so look at the top contour specifically, not the
   whole piece's silhouette.
2. Repeat the M6.4 real-device test matrix (docs section 16 above) for each: neutral,
   head left/right/up/down, move closer/farther, shoulders raised, hair beside/crossing.
   Confirm occlusion still visibly erases hair-covered pixels correctly for a CURVED
   piece — this is the one thing that could newly regress (curvature + occlusion
   composing) if the "one source of truth" wiring above were wrong somewhere.
3. Record real FPS/frame-time (`Show performance`) before vs. after enabling a
   necklace, for a choker (few strips visually matter less) and a tall haaram-shaped
   asset. The 20 extra `drawImage` calls/frame are NOT separately instrumented — they
   fall inside the EXISTING `renderMs`/`alphaMaskMs` measurements (unchanged fields),
   so compare those numbers directly rather than looking for a new counter.
4. Layer a necklace + a haaram together (`Choose pieces to layer`) and confirm both
   still track/curve independently without the vertical-layering offset breaking.

### Tests / build (Steps 14/15)

New: `jewellery-attachment.test.ts` (9), `jewellery-deformation.test.ts` (9), plus
strip-path tests added to `renderer.test.ts` and `asset-cache.test.ts`. `src/lib/live-ar`
suite: 275 → **301**. Full web suite: **342/342**. `npx tsc --noEmit`: clean. `npm run
build`: succeeds, same 7 routes. Lint: 53 problems before and after (identical count,
diffed against this milestone's own starting commit `13fe841`) — zero new issues; the
53 are the pre-existing, already-documented `react-hooks/refs`/`set-state-in-effect`
collateral pattern from every prior milestone. No generative AI touches the live camera
loop (Step 15) — nothing added here calls any AI/image-generation API.

### Honest limitations (Step 16)

1. **Achievable with current (flat PNG) assets, done this milestone**: attachment-class-
   aware placement/length (choker/necklace/haaram), a top-contour curvature bow, and
   physical-dimension-aware scale where the catalogue has it set.
2. **Requires asset preparation**: nothing added this milestone strictly requires new
   asset metadata (curvature/attachment class are derived from what already exists), but
   if/when `extra_measurements` starts carrying an explicit admin-supplied necklace
   length, `jewellery-attachment.ts`'s resolver should be updated to prefer it over the
   aspect-ratio heuristic (documented in that file's own docstring).
3. **Requires 2.5D deformation beyond this milestone's strip bow**: true front-to-back
   wrap-around (the piece's near/far side both visible as the head turns) — this
   milestone only bows the top contour, a rigid per-column shift, not a resampled wrap.
4. **Requires 3D jewellery models**: true depth/thickness, occlusion by the neck's own
   far side, physically correct draping under gravity for a long haaram's dangling
   portion.
5. **Requires depth estimation**: real per-user neck circumference/distance-from-camera,
   rather than the shoulder-width/face-width anthropometric-average calibration this
   pipeline (and the Python photo engine it mirrors) has used since Milestone 4.
6. **Requires lighting/material rendering**: specular highlights, contact shadows under
   the chin/collarbone, metal/gem material response — explicitly out of scope (M6.5
   Step 15 and this project's own architecture doc's "future realism" section).
7. **Could optionally use AI later**: generative harmonization for CAPTURED STILL
   IMAGES only (never the live camera loop) — unchanged from the M6.1 architecture
   audit's own conclusion.

**CODE VERIFIED, not REAL DEVICE VERIFIED.** Steps 9's real-camera tests and this
milestone's success criteria (17 of 18 are engineering claims already checked above;
#17, "real-device screenshots demonstrate the improvement," is yours to produce) are
not performed from this sandbox. Per the M6.5 request's own instruction: **STOP here —
do not begin M6.6.**

## 19. M6.6 — physical neck contact, depth & wearing behavior

### A. Why M6.5 still looked like a flat overlay (Step 1 audit)

Traced the full M6.5 pipeline (body reference → neck reference → jewellery attachment
→ strip deformation → transform → alpha footprint → occlusion → rendering) and found
the real architectural gap, not a Y-coordinate bug:

- **No neck SURFACE existed, only a neck POINT.** `NeckReferenceFrame` gave one
  attachment pixel plus a diagnostic width scalar — never a coordinate system with
  front/left/right regions (Step 1's literal checklist: neck surface, circumference,
  depth, perspective, front/back relationship, contact region — **none of these
  existed** before this milestone; this is the honest gap, not an approximation of one).
- **M6.5's curvature bow was angle-BLIND.** `computeJewelleryStrips`'s parabola shape
  was a fixed function of horizontal position only — identical on every frame
  regardless of head yaw. Turning your head could never change the necklace's shape,
  because nothing in the pipeline read a yaw signal at all.
- **No perspective/foreshortening concept anywhere.** The transform is translate →
  rotate → uniform scale; a uniform scale cannot make one side of the sprite narrower
  than the other, which is what "viewed at an angle" actually requires.
- M6.2's `shoulderDepth`/`bodyDepth` fields (real MediaPipe z) were computed but never
  read by anything — confirmed by grep, same as M6.5's audit found.

### B/C/D. The M6.6 model, algorithms considered, and what was chosen

**Considered** (Step 3): (A) mesh-based 2D deformation, (B) piecewise-affine strips,
(C) full Canvas mesh warp, (D) WebGL vertex deformation, (E) cylindrical/elliptical
projection.

**Chosen: (B) + (E) combined**, in `neck-projection.ts` (the shared math) +
`jewellery-deformation.ts` (turns it into a strip plan):

- The neck's cross-section is approximated as a semi-ellipse. Each attachment class
  (choker/necklace/haaram) models its contact curve as wrapping a
  `curvatureHalfAngleRadians` arc of that ellipse (`jewellery-attachment.ts`).
- `geometry.ts`'s new `estimateHeadYawAsymmetry` (extracted from the SAME face-edge-
  landmark math `resolveEarConfidence` already used — one source of truth, not a
  duplicate) gives a real, per-frame, measured yaw PROXY (2D landmark asymmetry, not a
  calibrated 3D angle — MediaPipe's `outputFacialTransformationMatrixes` would give a
  real 3D pose but isn't wired in; documented as a deliberate scope decision, not an
  oversight).
- That yaw proxy shifts (1) WHERE the contact curve's peak sits within the sprite
  (`computeContactPeakFraction` — Step 4's "contact curve must move with the neck"),
  and (2) a whole-sprite horizontal foreshorten factor (`computeHorizontalForeshorten`
  — Step 8's "apparent width changes appropriately with viewpoint"). Both are `cos`/
  distance-from-contact-point functions of the SAME angle, never independently tuned.
- **Rejected (D) WebGL**: explicitly ruled out by the request; Canvas 2D's existing
  strip mechanism extends cleanly to carry this without a new rendering technology.
- **Not attempted**: per-strip destination-width changes (a full asymmetric mesh
  layout) — deliberately avoided in favor of ONE whole-sprite foreshorten scalar, to
  keep the implementation a strict, byte-for-byte-at-yaw=0 generalization of M6.5
  rather than a riskier full rewrite. Documented as a real simplification (see O below).

### E. Files changed

New: `neck-projection.ts` (shared angle/depth/foreshorten math), `neck-surface.ts`
(debug-visualization neck boundary points), plus their test files.
Edited: `geometry.ts` (`estimateHeadYawAsymmetry`, extracted not duplicated),
`jewellery-attachment.ts` (`curvatureHalfAngleRadians` per class), `jewellery-
deformation.ts` (yaw-aware, now returns `{strips, horizontalForeshorten,
contactPeakFraction}`, recomputed every frame instead of cached per-asset-load),
`renderer.ts` (`horizontalForeshorten` param, defaults to 1 = no-op), `debug.ts` (wear-
geometry fields folded into the EXISTING `NecklaceDebugSnapshot`, not a second
snapshot type), `performance.ts` (`deformationMs`/`formatDeformationDebugText`),
`useLiveArSession.ts` / `LiveArStudio.tsx` (per-frame yaw estimation, comparison-mode
toggle + `wearComparisonCanvasRef`).

### F/G. Tests / count

New: `neck-projection.test.ts` (15), `neck-surface.test.ts` (3), plus yaw-responsiveness
tests added to `jewellery-deformation.test.ts`, `geometry.test.ts` (yaw asymmetry), 
`renderer.test.ts` (`horizontalForeshorten`), `debug.test.ts` (wear-geometry fields),
`performance.test.ts` (`deformationMs`). `src/lib/live-ar`: 301 → **342** (+41). Full
web suite: **383/383**.

### H/I. Build / lint

`npx tsc --noEmit`: clean. `npm run build`: succeeds, same 7 routes. Lint: 53 → 56
problems (+3), all confirmed (by diffing the exact flagged code text, not line
numbers) to be the SAME already-documented `react-hooks/refs` collateral pattern
(new ref writes / `<canvas ref={session.x}>` JSX in the same components) — zero new
categories.

### J/K. Real-device FPS / screenshots

**Not performed** — same sandbox limitation as M6.5 (no camera). `deformationMs` is
now instrumented (Step 14) specifically so this cost is visible once you do test on a
real device — expected to be negligible (≤20 iterations of plain arithmetic per neck
item per frame, no per-pixel work) but not claimed as such without a real number.

### L/M/N. Per-attachment-class result

Not observed on a real camera. What IS true by construction (verified by the pure-
function tests, not a screenshot): a choker's curvature half-angle (70°) is wider than
a haaram's (40°), so a choker's contact curve/foreshorten responds more to the same
yaw than a haaram's does — see `neck-projection.test.ts`'s "a smaller curvature
half-angle... foreshortens less" test. Whether this reads as visually correct on an
actual person is exactly what Step 13's real-device test (below) answers.

### O. Remaining limitations (Step 9/16)

Unchanged from M6.5's list, plus this milestone's own new ones:
- The yaw signal is a 2D landmark-asymmetry proxy, not a calibrated 3D head pose.
- Foreshortening is ONE whole-sprite scalar, not a per-region asymmetric compression —
  a real cylinder's near/far sides would compress by different amounts; this applies
  the same factor to the whole piece.
- The contact curve's peak-shift and the foreshorten are both driven by the SAME
  yaw proxy but are not derived from a single unified 3D projection — two related
  but separately-computed consequences of one angle, not one coherent 3D->2D mapping.
- Still no true depth buffer, 3D mesh, back-side geometry, or lighting/material
  response (Step 9's "cannot fully do" list, unchanged from M6.5).

### P. What M6.7 should address

Depends entirely on Step 13's real-device result (below):
- If the yaw response looks directionally right but under/over-shoots: retune
  `NECKLACE_YAW_SHIFT_STRENGTH`/`NECKLACE_CURVATURE_HALF_ANGLE_RADIANS` against a real
  camera (documented as UNCALIBRATED, same status as every other visual constant here).
- If foreshortening looks too uniform/flat: consider the per-region asymmetric
  compression this milestone deliberately deferred (see O above) — now that the
  simpler whole-sprite version's real limitation is visible on camera, not guessed at.
- If contact placement still looks disconnected from the neck: revisit whether
  `estimateHeadYawAsymmetry`'s 2D proxy is too noisy, and whether wiring MediaPipe's
  `outputFacialTransformationMatrixes` (a real 3D head pose, available but unused) is
  now justified by real evidence rather than speculative scope.

### Real-device test protocol (Step 13) — for you to run, not predicted here

1. Open `/try-on/live`, select a necklace, enable "Show necklace debug" (now includes
   the M6.6 markers: deepskyblue neck-boundary line, chartreuse contact curve) and
   "Show wear comparison (M6.5 vs M6.6)" (bottom-left thumbnail).
2. **Tests 1-7** (straight/left/right/tilt/closer/farther/shoulders): for each, compare
   the main canvas against the M6.5-equivalent thumbnail. Do NOT judge "is this
   photorealistic" — judge whether the main view's necklace shape visibly differs from
   the thumbnail's fixed shape when you turn your head, and whether that difference
   goes the RIGHT direction (narrower/shifted toward the side you turned away from).
3. **Tests 8-9** (hair beside/crossing): confirm M6.4 occlusion still works exactly as
   before — hair should still erase the correct pixels regardless of the new curvature.
4. **Test 10**: repeat with a choker-shaped item vs. a haaram-shaped item — the choker
   should show a visibly stronger response to the same head turn (wider curvature
   half-angle) than the haaram, per O above.
5. Enable "Show performance" and read the new "Deformation" line — record its avg/p95
   ms, and note whether FPS changed at all from M6.5 (expected: no, or negligible).
6. Report back: for each test, items 1-9 from Step 13's checklist (attached/floats/
   contact stable/width changes/follows body/hair correct/clothing correct/stable at
   distance), plus the Deformation timing line and any FPS change observed.

**CODE VERIFIED, not REAL DEVICE VERIFIED.** Do not read this section as "M6.6
complete" — per the request's own instruction: **STOP here — do not begin M6.7.**

## 20. M6.7 — jewellery representation upgrade / 3D-ready Live AR

Full Steps 0-11 audit, option comparison, and architecture design in
[`docs/live-ar-3d-representation-assessment.md`](live-ar-3d-representation-assessment.md)
— kept as its own document (like M6.1's architecture audit) rather than appended here,
since it's a forward-looking technical assessment, not a per-frame verification log.

**Summary**: a flat PNG cannot represent genuinely new viewing angles/depth/thickness
under head rotation, no matter how sophisticated the 2D deformation math gets — 2D
warping can only rearrange pixels that already exist, never synthesize a side view
that was never photographed. That is the real, precise reason M6.6 still looks like an
overlay under rotation. Implemented: `jewellery-representation.ts` (the Step 4
representation contract — `flat-2d`/`layered-2.5d`/`gltf-3d`, always resolving to
`flat-2d` today, 8 tests), deliberately NOT wired into the render loop (no consumer
exists yet). **Stopped at Step 11 per its own explicit instruction**: no `.glb`/`.gltf`
asset, and no Three.js/Babylon.js/WebGL dependency, exists anywhere in this
repository (confirmed by direct search, not assumed) — a real 3D asset is required
before Steps 12-14 (POC real-device test, before/after comparison, 3D performance)
can be performed; none was fabricated. `src/lib/live-ar`: 342 → **350** (+8). Full web
suite: **391/391**. `tsc`/lint/build all clean (zero new lint findings — this round
touched no component/JSX files at all). **STOP — do not begin M6.8.**
