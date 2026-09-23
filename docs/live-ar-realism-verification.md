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
