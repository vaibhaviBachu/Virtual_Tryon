# M6.2 Verification — Live AR Depth Foundation

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

## Sources

- [Pose landmark detection guide — Google AI Edge](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker/web_js) — PoseLandmarker z convention (hip-midpoint origin).
- [Face landmark detection guide — Google AI Edge](https://developers.google.com/mediapipe/solutions/vision/face_landmarker) — FaceLandmarker z convention (head-center origin).
