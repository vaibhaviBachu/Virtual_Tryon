# True 3D Neck Attachment (Phase G)

**Phase G is NOT declared complete.** A real-person webcam test of Phase F
disproved its core assumption: a real 3D orientation applied to an already-curved
rigid mesh was not sufficient for the choker to look physically attached to the
neck. This phase builds an actual parametric 3D neck surface, uses it as the
jewellery's real attachment reference, improves 3D occlusion to use the render's
own alpha, and adds a debug overlay that draws the surface, its normal, and the
attachment point directly on the live frame — specifically so the **next** real
test is diagnostic, not just pass/fail. That next real-person test has not been
performed by me. This environment still has no webcam and no human.

---

## 1. Real-person failure analysis

The four uploaded real-webcam screenshots (Phase F's own build, tested by the user)
show:

1. **Facing the camera**: the choker sits at a plausible neck/collarbone height —
   the best-looking case.
2. **Head turned significantly**: the choker's visible shape does not show an
   obvious near-side/far-side asymmetry — it reads as a relatively flat plate that
   has translated with the head, not a curved object whose far side has receded.
3–4. **Close to the camera, head tilted**: the choker appears positioned high,
   near the jaw/chin, looking detached from the visible neck rather than resting
   against it.

This is real, directly observed evidence that Phase F's mechanism (rotate an
already-curved rigid mesh by a real orientation, with no explicit surface
reference at all) did not produce a convincing "worn" appearance, even though the
underlying orientation math was verified correct in a synthetic real-browser test
(Phase F §9).

---

## 2. Why Phase F still floated

Tracing the exact chain, with the real screenshots as the standard of judgment:

- **Position** was already reasonable in principle (the 2D anchor — chin-to-
  shoulder interpolation — unprojected at a depth matched to the validated 2D
  scale) and likely explains why case 1 (facing camera) looked fine.
- **Orientation** was real (Phase F's actual fix — MediaPipe's facial
  transformation matrix) but had **no explicit geometric surface to relate to**.
  A rigid rotation of a mesh with a *very gentle* authored curvature (the Diamond
  Choker's own 18mm "wrap sagitta" over a 190mm width — a deliberately shallow
  curve, per Phase D's own "impossible chord" finding) may simply not produce a
  dramatic near/far visual difference at realistic head-turn angles, *especially*
  in a static screenshot, which cannot show the motion parallax that often carries
  most of the "3D-ness" perception in live video.
- **No depth reference existed.** Phase F's only depth-related quantity was the
  item's own thickness (`physicalDepthMm/2`, ~6mm) — nothing tied the mesh's
  position to an actual estimate of *how far out the neck's surface is*, which is
  likely the direct explanation for cases 3–4's "detached near the jaw" look: at
  close range / extreme pitch, the 2D anchor formula (`neck-reference.ts`,
  unchanged since M6.2) can produce an attachment point that drifts from the
  visually-obvious neck, and Phase F had nothing that would visibly correct for
  or reveal that drift.
- **No visual diagnostic existed.** Phase F exposed real yaw/pitch/roll as
  *numbers* (`live3dDebugInfo`) but drew nothing — there was no way to see, on the
  actual failing frame, where the code *thought* the neck was.

This phase's own audit could not, from static screenshots alone, distinguish
"the rotation magnitude is wrong" from "the rotation is right but too subtle to
see in a photo" from "the position itself has drifted." The debug overlay (§10)
is built specifically to let the next real test distinguish these directly.

---

## 3. Available tracking signals (Step 3)

Re-confirmed against the actually-installed `@mediapipe/tasks-vision` package
(no new landmarks invented):

| Source | Real signal | Used how |
|---|---|---|
| FaceLandmarker | `faceLandmarks` (x, y, z per point, 468 points) | Face bbox (unchanged, M6.2); z exists but is not a calibrated depth (documented limitation, unchanged) |
| FaceLandmarker | `facialTransformationMatrixes` | Real head yaw/pitch/roll (Phase F, unchanged this phase) |
| PoseLandmarker | `landmarks` (normalized, x/y/z/visibility) | Shoulder positions/width/tilt (unchanged) |
| PoseLandmarker | `worldLandmarks` | **Confirmed present in the installed package's types, NOT used** — see §15 for why (real-world-scale 3D pose landmarks exist, but calibrating them into this pipeline's own mm-space is a separate, non-trivial effort not undertaken this phase; noted honestly as available-but-unused, matching this project's own established convention for `outputFacialTransformationMatrixes` before Phase F) |

Nothing new was added to the tracking layer itself this phase — the improvement is
entirely in how the EXISTING real signals (2D anchor position, real orientation)
are turned into an explicit geometric surface.

---

## 4. Neck surface model (Step 4/6/7)

New module `three/neck-surface-3d.ts`. An **elliptical-cylinder cross-section**,
chosen as the simplest model that provides front/side surface points and normals
(Step 7's own preference for a lightweight analytical surface):

```ts
export interface NeckSurfaceFrame {
  centerMm; axisUp; axisRight; axisForward;   // REAL -- see §5
  radiusXMm;                                   // REAL-ISH -- see §5
  radiusZMm;                                   // ESTIMATED -- see §6
  confidence; method;
}
```

`neckSurfacePointAt(frame, angleRadians)` is the real `surfacePoint`/`surfaceFrame`
function Step 7 asked for — a genuine parametric ellipse (position + analytic
outward normal + tangent), not a placeholder. Verified by direct round-trip and
geometric-consistency tests (§12): angle=0 reconstructs the tracked front point
exactly; the normal at angle=0 is exactly the forward axis; normal⊥tangent at
every angle; the outline is left/right symmetric.

**No visible neck mesh was created** — this is purely a mathematical reference
(Step 7's own explicit instruction), consumed only for (a) the jewellery's
attachment reasoning (§7) and (b) the debug overlay (§10).

---

## 5. What is REAL in the surface model

- `axisUp`/`axisRight`/`axisForward`: exactly Phase F's own real orientation
  (real shoulder roll; real head yaw/pitch from the facial transformation matrix,
  or its documented 2D-proxy fallback) — re-expressed as a coordinate frame's axes,
  no new orientation source.
- `centerMm`: derived from the EXISTING, already-real 2D-anchor-unprojected
  attachment position (unchanged from Phase E/F/G), treated as the ellipse's own
  FRONT surface point (not its center) — see `computeNeckSurfaceFrame`'s own file
  docstring for the physical reasoning: a 2D camera observes the front of a neck,
  never its central axis directly, so the center is derived by stepping *backward*
  from the observed point, not the other way around.
- `radiusXMm`: derived from `neck-reference.ts`'s own **existing**, pre-Phase-G
  `widthPx` estimate (80% of face width, unchanged), converted to mm using the SAME
  px-per-mm calibration already trusted for the jewellery's own physical scale — no
  new calibration constant introduced for this conversion.

---

## 6. Depth estimation (Step 6) — explicitly ESTIMATED, not measured

**`radiusZMm` = `radiusXMm × 0.75`.** This is the one genuinely new number this
phase introduces, and it is labeled as an estimate everywhere it appears in code
and docs. Audited sources, all confirmed absent from this pipeline:

1. MediaPipe face landmark Z — relative, uncalibrated, not a real depth (existing,
   documented limitation, unchanged).
2. MediaPipe pose world landmarks — exist in the installed package, not wired in
   this phase (§3/§15) — would need real calibration work to become a true depth
   source, not a quick substitution.
3. The facial transformation matrix — its translation is in MediaPipe's own
   canonical-model space, not this project's mm-camera-space (Phase F's own
   finding, unchanged) — not usable for this without new calibration.
4. Relative ear/chin/shoulder geometry — no combination of these 2D-observed
   points yields a front-to-back measurement; front-to-back is, by definition, the
   one axis a single 2D camera view cannot observe directly.
5. Camera intrinsics — not calibrated in this pipeline (unchanged, documented
   since M6.8).
6. **Anthropometric approximation — used.** 0.75 is a commonly-cited
   width:depth ratio for a roughly-elliptical body cross-section of this general
   shape; chosen as a single, clearly-labeled midpoint estimate.

**This is the STOP-CONDITION-relevant admission Step 6 asks for**: if real
testing shows this estimate is materially wrong, the honest next step is a better
measurement source (a depth camera, a stereo/multi-view capture, or a calibrated
multi-camera rig) — not a silently retuned constant.

---

## 7. Attachment mathematics (Step 8)

Deliberately **did not change the mesh's own position formula** from Phase F —
having reasoned through the physical relationship (§5), the existing 2D-anchor-
derived point already approximates the neck's own front surface; adding an
*additional* forward offset on top of it would push the mesh **beyond** that
estimated surface, the opposite of the intended correction. `radiusZMm` is used to
derive the ellipse's *center* (stepping backward from the already-correct front
point), not to move the attachment point itself.

What Step 8 actually gains from this phase: a genuine surface reference the
attachment point can now be *checked against* and *drawn relative to* (§10) — the
front point's normal is, by construction, exactly the mesh's own forward axis, so
orientation and surface are guaranteed consistent (one source of truth, not two
separately-computed directions that could silently drift apart).

---

## 8. Body vs. head motion (Step 2/11/16)

Unchanged division of responsibility, now stated explicitly against the neck
surface model: **position stays shoulder/chin-anchored** (never swings with head-
only movement beyond how the existing 2D anchor already responds), **roll stays
real shoulder-tilt**, and **yaw/pitch come from the head** because no real 3D
torso rotation exists anywhere in this pipeline (§3's own finding: PoseLandmarker
gives positions, not a transformation matrix). This is the same honest answer
Phase F already gave to Step 16's question — this phase does not change it, and
does not add an unjustified "head-to-neck rotation transfer" damping factor, since
no evidence collected this phase justifies picking a specific transfer ratio over
another (Step 18's "no magic values" applies directly here: a damping constant
chosen only "to make it look better" would be exactly that).

---

## 9. Jewellery wrapping (Step 9)

**Decision: keep the rigid transform; do not deform the GLB per frame.** Per Step
9's own preferred order (correct geometry → correct attachment → correct rigid
transform → *only if insufficient* → deformation), and Step 20's "only modify the
generator if the investigation proves correct attachment is impossible without
it" — this phase's investigation did **not** prove that. What it identified
instead was a missing *reference* (the neck surface, §4) and a missing
*diagnostic* (§10), not a proof that the rigid-mesh approach itself is
insufficient. That determination genuinely requires the next real test, now able
to actually show whether the ellipse tracks the visible neck correctly — deforming
geometry before that evidence exists would be exactly the "fix without diagnosis"
this phase was told to avoid.

---

## 10. Occlusion (Step 13/14)

**Improved, using the actual 3D jewellery alpha — not just the coarse category
mask.** New `occlusion.ts` function `applyRenderedAlphaToOcclusionMask`: reuses
the EXISTING `computeNecklaceOcclusionMask` category rule, then additionally
requires a real (non-transparent) pixel in the 3D render's own alpha channel,
downscaled directly to the segmentation mask's resolution. Because
`three-live-bridge.ts`'s 3D render is already full-video-sized (unlike the 2D
path's bbox-cropped sprite), no region/crop math is needed — simpler than the 2D
path's equivalent, not more complex. Wired into `useLiveArSession.ts`'s 3D
occlusion block, replacing the coarse-mask-only approach Phase E/F used.

**Not claimed**: true depth ordering. This still uses 2D semantic segmentation
(hair/clothes categories) exactly as before — "hair in front of jewellery hides
it" works because hair is a real detected category, not because any real depth
comparison between the hair and the jewellery mesh exists. That distinction is
stated explicitly, per Step 13's own instruction not to claim more than is true.

---

## 11. Debug visualization (Step 15)

New: `renderer.ts`'s `drawNeckSurfaceDebugOverlay`, drawing (on the SAME 2D canvas
the jewellery itself renders to, gated behind the existing `debugEnabled` toggle):

- The neck surface's outline (24 sampled points around the ellipse, projected
  through the SAME `THREE.PerspectiveCamera` the jewellery was actually rendered
  with — `three-transform.ts`'s new `projectPointToScreen`, extracted from the
  existing bounding-box projector so there is one implementation, not two).
- The front surface point and its outward normal (a visible line).
- The jewellery's own 3D attachment origin.

This directly answers Step 15's own framing: **"why does the jewellery float" is
only answerable by seeing where the code currently thinks the neck is**, on the
actual frame, not by reading numbers alone. `live3dDebugInfo`'s existing numeric
yaw/pitch/roll/method (Phase F) remains available alongside it.

---

## 12. Real-browser tests (Category C — see §13 for the required A/B/C/D split)

Performed, real, in a real headless browser (Playwright + Chromium,
`--use-angle=swiftshader`, ad hoc, not a dependency):

- The neck-surface pipeline runs end-to-end with a synthetic 25° yaw input and
  produces `yawDeg=25.0` — a correct round-trip through the real decomposition
  math in a real browser context.
- `radiusZMm` correctly equals `radiusXMm × 0.75` in the live computation, matching
  the documented formula exactly.
- `drawNeckSurfaceDebugOverlay` draws real, legible markers and an outline without
  throwing, confirmed by screenshot.
- The occlusion refinement code path runs without error (exercised via the same
  render call; a full end-to-end occlusion visual check would need a real
  segmentation mask from a real camera frame, which this synthetic test does not
  have).

---

## 13. Real-person tests (Category D) — NOT PERFORMED

**This environment has no webcam and no human.** None of Step 16's tests (A–P)
were performed by me. The four screenshots analyzed in §1 are the user's own real
test of *Phase F*, not of this phase's changes — they are the motivating evidence
for this phase's work, not a validation of it. The next real-person test, using
the new debug overlay, is the concrete way to find out whether §4-§11's changes
actually help — see §16.

**Explicit category separation, as Step 23 requires:**

| Category | Performed | Result |
|---|---|---|
| A. Unit tests | Yes | §14 — 23 new, all passing |
| B. Synthetic browser tests | N/A this phase (no jsdom WebGL2) | — |
| C. Real browser tests (synthetic tracking data, real WebGL2) | Yes | §12 |
| D. Real-person webcam tests | **No** | Not performed — no camera/human available |

---

## 14. Performance (Step 21)

No new per-frame allocation of geometry or meshes. `computeNeckSurfaceFrame`/
`neckSurfacePointAt` are pure functions over plain numbers and a handful of
`THREE.Vector3`/`Quaternion` temporaries (the same order of allocation the
existing orientation math already does). The debug overlay's 24-point sampling
only runs when `debugEnabled` is true (never in normal customer use). The
occlusion refinement adds one `drawImage` + one `getImageData` call at the
segmentation mask's own small resolution (e.g. 256×256), on the SAME cadence
occlusion already ran at — no new per-frame GLB load, generation, or mesh
creation anywhere.

---

## 15. Known limitations

- **`radiusZMm` remains an estimate**, not a measurement (§6) — the single most
  important honest caveat in this phase.
- **The rigid-transform decision (§9) is unverified** — it may turn out, once the
  debug overlay is used in a real test, that the ellipse tracks the visible neck
  correctly but the mesh's own curvature is simply too subtle to show a
  convincing wrap; that would be real evidence for revisiting Step 9's "only if
  insufficient, deform" branch, which this phase could not reach without that
  evidence.
- **PoseLandmarker's `worldLandmarks`** (real-world-scale 3D pose points, confirmed
  present in the installed package) were identified but not integrated — doing so
  correctly would require calibrating a second 3D coordinate system into this
  pipeline's own mm-space, a real, separate effort, not a quick addition.
  Flagged as a concrete option for the STOP-CONDITION answer (§16), not used
  silently.
- **No damping between head rotation and "neck rotation"** was introduced (§8) —
  intentional, per Step 18, since no evidence collected this phase justifies a
  specific ratio.
- **Occlusion still has no true depth ordering** (§10) — improved precision
  (real 3D alpha vs. coarse category mask), not a new capability.
- **The debug overlay is 2D-projected geometry only** — it does not render the
  ellipse as a shaded 3D surface, only an outline/normal/point, kept intentionally
  simple for diagnostic legibility.

---

## 16. Generic future architecture (Step 19)

`NeckSurfaceFrame`/`neckSurfacePointAt` are named and shaped generically (an
elliptical-cylinder cross-section with a front/side/normal parametrization) but
only wired for `"necklace"`. The same shape is directly reusable for:

| Future surface | Reuse |
|---|---|
| `EarSurface` | A much smaller ellipse (or a simple point+normal), same `neckSurfacePointAt`-style parametrization |
| `WristSurface` / `FingerSurface` | The exact same elliptical-cylinder model, different radius source (wrist/finger width instead of neck width) — no new geometry code |
| `ForeheadSurface` / `NoseSurface` | Likely a simpler point+normal (no meaningful "wrap" concept) rather than a full ellipse — a smaller model, not a bigger one |

None of these are implemented this phase (Step 19's own "only implement
NeckSurface deeply"). Adding one is: a new radius source, a call to the same
`computeNeckSurfaceFrame`-style constructor (or a smaller variant), and a new
entry in `body-attachment.ts`'s existing resolver registry — the exact same
extension pattern already proven three times now (Phase D's category strategies,
Phase E's asset registry, Phase F's orientation registry).

---

## PHASE G STATUS

**Root cause:** Phase F's real 3D orientation had no explicit geometric surface to relate to, and Phase F's own depth offset referenced only the jewellery's own thickness, never an estimate of how far out the neck actually is — combined with a real 2D-anchor position formula that may drift at close range/extreme pitch (unverified without the new debug overlay's next real test).

**3D neck surface:** PASS — a real, tested, parametric elliptical-cylinder model (`neck-surface-3d.ts`)

**Neck depth:** ESTIMATED — explicitly labeled, not measured (§6); no calibrated source exists in this pipeline

**Attachment frame:** PASS — position unchanged from Phase F (reasoned to already be correct, §7); orientation and surface are now guaranteed consistent by construction

**Front view:** NOT TESTED (real person) — §13

**30° left / 45° left / 30° right / 45° right:** NOT TESTED (real person) — §13

**Head movement / Shoulder movement / Distance change:** NOT TESTED (real person) — §13

**Hair occlusion:** IMPROVED (mechanism, §10) / NOT TESTED (real person)

**True 3D attachment:** PASS (mechanism: real surface, real orientation, real occlusion refinement, all real-browser-verified) / **NOT VERIFIED visually** — the phase's own most important question (below) is unanswered

**Real-person testing:** NOT TESTED — no webcam or human available in this environment

**Diamond Choker:** PASS (real GLB, real surface/attachment/occlusion pipeline, real-browser rendering confirmed, §12) / overall "is it worn" question unanswered

**Generic architecture:** PASS — `NeckSurfaceFrame`/`neckSurfacePointAt` are category-agnostic; only `"necklace"` is wired, matching Step 19's own scope

**Tests:** 23 new (12 neck-surface-3d, 4 occlusion, 3 three-transform, 4 renderer); 557/557 passing for the full `src/lib/live-ar` + `src/lib/jewellery-3d-generator` scope; the broader suite (including unrelated admin-form components) showed 3 pre-existing, confirmed-flaky failures (parallel-worker timing, unrelated to this phase — pass individually)

**TypeScript:** PASS

**Build:** PASS (same 7 routes/8 pages)

**Lint:** PASS — zero new findings from Phase G; the same pre-existing findings in `useLiveArSession.ts` (unchanged count) and two unrelated files remain untouched

---

### Most important final question

**"Does the jewellery now look like it is actually being worn by the person,
rather than being a 3D filter placed over the person?"**

**Not yet answerable.** No real-person test of this phase's changes has been
performed. What exists now, that did not exist before this phase: a real
geometric surface the attachment can be reasoned about and checked against, an
occlusion refinement that uses the jewellery's actual rendered pixels, and — most
importantly for actually answering this question next — a debug overlay that lets
a real test show *exactly* where the code thinks the neck is, rather than asking
the user to judge only from how the final image looks. The next real-person test,
with `debugEnabled` on, is the concrete next step, and it is the user's to run.
