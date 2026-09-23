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

## Real device (Steps 13/21/22) — NOT MEASURED

- Device: **not tested**
- Browser: **not tested**
- OS: **not tested**
- Camera resolution: **not tested**
- Segmentation inference average/median/p95: **not measured**
- Overall live FPS average/observed range: **not measured**
- Mask alignment quality: **not observed**
- Hair segmentation quality: **not observed**
- Clothing segmentation quality: **not observed**
- Memory/lifecycle behavior over a long real session: **not observed**

This is not an oversight — it is the honest boundary Step 13 itself describes ("the
development sandbox cannot provide the final camera verification"). Every field above
requires you (or whoever has a real device) to open `/try-on/live`, enable "Show
segmentation debug," and read the on-screen status/timing line and the colorized mask
overlay against your own face/hair/clothing, then report back what was actually seen.

## Whether the result is acceptable for M6.4 (Step 19)

**Cannot be determined from this session alone.** Code correctness is verified (tests,
types, build). Whether the real inference cost, mask alignment, and mask quality are
good enough to build occlusion on top of is exactly the open question M6.4 is gated on,
and answering it requires the real-device data this section could not collect. Per the
request's own Step 21, if a real device later shows unacceptable performance, that
should be reported as "NOT ACCEPTABLE FOR CURRENT DEVICE/CONFIGURATION" with the actual
numbers and the fallback options below — not hidden.

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
