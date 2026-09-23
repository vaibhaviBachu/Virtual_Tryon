# Live AR Realism Architecture — Audit & Proposal

**Status: audit only. No implementation has started.** Per the request that produced
this document, implementation is explicitly gated on review of this document —
everything below is research/analysis, not a changelog.

This document answers one question with evidence, not guesswork: *why does jewellery in
Live AR currently read as a flat filter/sticker rather than something worn, and what
would it actually take to change that?* Every claim below is either a direct file/line
citation from this repository, a number from a fetched, cited source, or explicitly
labeled as unverified/needing real-device measurement. Nothing here should be read as
already implemented.

## 1. Current architecture (what actually runs today)

Live AR (`/try-on/live`) is a browser-only, per-frame loop with no server round-trip:

```
getUserMedia (camera.ts)
      -> FaceLandmarker + PoseLandmarker, VIDEO mode (tracking.ts, @mediapipe/tasks-vision)
      -> neck reference estimate (neck-reference.ts, interpolated chin-proxy -> shoulder midpoint)
      -> per-category geometry: anchor + scale + rotation (geometry.ts)
      -> EMA smoothing (smoothing.ts) + GOOD/DEGRADED/LOST state machine (tracking-state.ts)
      -> Canvas 2D compositing: draw video frame, then translate/rotate/scale/drawImage
         the jewellery PNG (renderer.ts::drawJewelleryOverlay)
```

This loop lives in `useLiveArSession.ts`, driven by `requestAnimationFrame`. The jewellery
texture itself is a pre-cut, alpha-channel PNG produced once at catalogue-upload time by
the worker (`workers/tasks/process_jewellery_asset.py`, `rembg`/U-2-Net background
removal) — Live AR never re-touches the product's own pixels, only where/how large/how
rotated to draw them. This "never alter the product's own pixels" rule is a deliberate,
repeatedly-stated project constraint and this audit does not propose changing it.

The async photo pipeline (`/try-on`, Milestone 3/4) is architecturally separate: it runs
the same geometry family server-side in Python (`ai/geometry/{constants,transform,
compositing}.py`) against an uploaded photo, once per render request. It shares math, not
runtime, with Live AR.

## 2. Root causes of the "filter" appearance (evidence, not opinion)

Four independent, verified gaps, all pointing the same direction:

1. **No occlusion anywhere in the stack, front or back end.** `ai/geometry/compositing.py`'s
   `alpha_composite()` is a plain two-image "over" blend — it takes only the base photo and
   the jewellery overlay and has no knowledge of any mask. Confirmed by grep: neither
   `ai/engines/geometry/engine.py` nor `ai/geometry/transform.py` ever reference the
   segmentation mask that Milestone 3 *does* compute
   (`workers/tasks/process_tryon_request.py` → `ai/segmentation/person_segmenter.py` →
   stored at `TryOnRequest.segmentation_mask_key`). That mask is read exactly once,
   as a scalar confidence score inside `evaluate_readiness()` — never as pixels, never to
   decide what draws in front of what. Live AR is worse off still: **no segmentation model
   of any kind loads in the browser today** — `ImageSegmenter` is not imported anywhere in
   `apps/web/src` (verified by exhaustive grep). So "hair over necklace" isn't a bug in the
   renderer; it's a capability that has never existed in either pipeline.
2. **Real depth data is captured and then thrown away.** `tracking.ts` converts MediaPipe's
   raw landmarks and explicitly copies the `z` field (`tracking.ts:118`,
   `return landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }))`).
   `types.ts:23` declares `z?: number` on the shared landmark type. But `geometry.ts` and
   `body-reference.ts` — the two files that actually decide placement — never read `.z`
   anywhere (verified by grep; zero matches). MediaPipe's Face/PoseLandmarker already give
   a real per-landmark relative-depth signal every single frame, for free, and it is
   currently discarded before it reaches placement logic.
3. **Rotation and scale are both intentionally 2D/average-based**, in both the Python and
   TypeScript geometry (`ai/geometry/constants.py`, `apps/web/src/lib/live-ar/constants.ts`):
   rotation is in-plane only (no head yaw/pitch/roll term), and scale is calibrated off a
   fixed anthropometric average (`AVERAGE_ADULT_FACE_WIDTH_MM`/`AVERAGE_ADULT_SHOULDER_WIDTH_MM`),
   not a per-user or depth-derived measurement. Both are already documented, honest,
   *intentional* Milestone 4 limitations — not something this audit needs to "discover,"
   but directly relevant to why jewellery doesn't foreshorten or tilt in 3D as a head turns.
4. **No shadow/contact cue exists at all right now** — three real attempts were made and
   fully reverted (see §9 for the specific, diagnosed reason each one broke).

None of this is a surprise to the codebase's own prior documentation:
`docs/live-ar-architecture.md`'s "Future realism architecture" section already names
"depth-aware occlusion," "shader-based lighting/material rendering," "perspective-aware
(3D) rendering," and "shadow synthesis" as deliberately deferred, not implemented. This
audit's job is to turn that into an evidence-backed, ordered, buildable plan — not to
re-discover that the gap exists.

## 3. Target experience

Restated from the product ask: the customer should perceive the jewellery as occupying
the same physical space as their body — resting on the neck/ear/wrist, partially covered
by hair or clothing where anatomically correct, casting a small local shadow, and
plausibly matching scene lighting — without claiming full photorealism or true 3D. The
honest engineering target, in this document's own words: *jewellery reads as worn, not
pasted over the camera image.* Nothing here promises 100% realism.

## 4. Proposed realism pipeline (stages, not one function)

```
TRACKING (existing: FaceLandmarker + PoseLandmarker, VIDEO mode)
   |
BODY REFERENCE (existing: neck-reference.ts, body-reference.ts)
   |
JEWELLERY GEOMETRY (existing: geometry.ts — anchor/scale/rotation)
   |
DEPTH (NEW, cheap first pass: reuse landmark .z already captured, see §5)
   |
SEGMENTATION / OCCLUSION MASK (NEW: MediaPipe ImageSegmenter, multiclass, see §6)
   |
SHADOW (NEW: isolated offscreen-canvas contact shadow, see §9)
   |
COMPOSITING (extend renderer.ts: video -> jewellery -> shadow -> hair/clothing matte)
```

Each stage stays a separate, independently testable module, matching this codebase's
existing convention (tracking/geometry/smoothing/renderer are already separate files with
single responsibilities) — this is additive to that pattern, not a rewrite of it.

## 5. Depth strategy

**Do not add a new depth-estimation model as the first move.** MediaPipe's
FaceLandmarker and PoseLandmarker — both already loaded and running every frame — emit a
`z` coordinate per landmark (relative depth from the camera), and the code already
captures it (`tracking.ts:118`) before discarding it downstream. For the specific
relative-depth question this project needs ("is the jewellery in front of or behind this
part of the body"), that per-landmark z is very likely sufficient for a first real
implementation, at zero additional model load or per-frame cost. Recommended first step:
wire `.z` through `geometry.ts`'s anchor/scale computation and use shoulder/neck-region z
relative to the jewellery's own assumed depth (roughly "resting on the skin surface") to
decide occlusion ordering *before* evaluating whether a dedicated monocular depth model
is justified.

A dedicated depth model (Depth Anything V2, small/base checkpoints, Apache-2.0 — already
identified in `docs/ai-research.md`/`docs/model-comparison.md` as the Milestone-0
candidate for "finer 3D placement," explicitly deferred as post-MVP, with a documented
caveat that some checkpoint releases carry a separate non-commercial license that must be
re-verified per checkpoint before use) should stay **out of scope for this phase**. It
solves a different, harder problem (dense per-pixel depth) than the one actually blocking
realism today (coarse front/behind ordering for a handful of body regions), and it would
add real per-frame browser inference cost this project has not yet needed to pay.

## 6. Occlusion strategy

**Use MediaPipe's multiclass ("selfie_multiclass") `ImageSegmenter`**, which classifies
every pixel as `0 background / 1 hair / 2 body-skin / 3 face-skin / 4 clothes / 5 others
(accessories)` (confirmed via Google's own image-segmenter guide, see Sources). This is
the exact model `docs/ai-research.md` already selected in Milestone-0 research for
"hair/cloth/fingers drawn back over the jewellery per segmentation" — it was never
integrated only because, at Milestone 3 implementation time, the Tasks API that exposes
it returned a `storage.googleapis.com` 403 *inside this development sandbox*. That is a
sandbox network-egress restriction, not a licensing decision (`ai/models/LICENSES.md`
lists it Apache-2.0, commercial-use "Yes") and not a design rejection. Crucially, it is
also not a real-world blocker: Live AR's own `FaceLandmarker`/`PoseLandmarker` already
fetch their `.task` model files from that identical `storage.googleapis.com` host, at
runtime, inside the customer's own browser — and that already works in production (this
is the whole reason Live AR exists as a shipped feature today). The `ImageSegmenter`
multiclass model would be fetched the same way, by the same browser, from the same host,
via the SDK version (`@mediapipe/tasks-vision@1.0.1`) already installed — no new
dependency, no new license review beyond adding its row to `ai/models/LICENSES.md`, and
no reason to expect the sandbox's restriction to reappear for real users.

**Mechanism (Canvas 2D, no renderer rewrite required):** once a `categoryMask` is
available for the current frame, build an offscreen canvas containing only the
hair/clothes pixels (mask class 1 and 4) copied from the live video frame, fully
transparent elsewhere, then draw that offscreen canvas with plain `source-over` *on top
of* the already-composited video+jewellery frame. Hair/clothing that anatomically sits in
front of the neck/ears will then visually cover the jewellery wherever the mask says it
should, without needing true 3D depth ordering — this is the standard "matte" technique
and does not require any change to how the jewellery sprite itself is drawn.

`PoseLandmarker` also exposes a built-in `outputSegmentationMasks` option
(`vision.d.ts:2718/2740`) that yields a binary person/background mask essentially for
free (it is already loaded and running). That mask cannot distinguish hair from clothing
from skin, so it cannot drive the hair-over-necklace cue on its own — but it is worth
keeping in mind as a much cheaper fallback (e.g., a coarser "person silhouette" gate) if
the dedicated multiclass segmenter turns out to be too expensive on low-end mobile (see
§8's performance caveat).

## 7. Renderer strategy

**Stay on Canvas 2D through occlusion and contact-shadow work.** The occlusion technique
in §6 and the shadow technique in §9 are both plain layered `drawImage`/compositing
operations on isolated offscreen canvases — they do not need a shader, a 3D mesh, or a
GPU pipeline. `renderer.ts`'s existing file-header rationale for choosing Canvas 2D over
WebGL remains correct for this next phase; its own stated honest limitation — "a WebGL
path would matter once ... depth-aware occlusion, shader-based lighting/material
rendering ... is built" — should be read narrowly: WebGL becomes justified specifically
for **shader-based lighting/material rendering** (§10/§11, e.g. specular highlights on
gold, environment reflections), not for basic segmentation-driven occlusion or a soft
local shadow, both of which are 2D compositing operations. Recommendation: defer the
WebGL/WebGPU renderer-abstraction work (Phase 6 of the original request) until lighting/
material rendering is actually attempted, not before — introducing it earlier adds real
complexity (a `LiveRenderer` abstraction, feature detection, a fallback path, shader code)
for a payoff this phase doesn't need yet.

## 8. Performance expectations (measured where possible, flagged where not)

Google's own published benchmark for the multiclass segmenter (`selfie_multiclass_256x256`,
float32) on a Pixel 6 is **217.76 ms CPU / 71.24 ms GPU** per inference (see Sources) —
i.e., roughly 14 fps on GPU delegate for segmentation *alone*, before face/pose tracking,
geometry, shadow compositing, and the video draw itself are added on top of the same
frame budget. This is a real risk to the 24–30 fps target, especially on mid/low-end
mobile, and **this number is Google's, measured on their device, for their model — it is
not a measurement of this app and must not be treated as one.** Concretely: run
segmentation at a reduced, explicit cadence (e.g., once every 3–4 rendered frames) and
hold the last mask between updates — hair/clothing silhouette boundaries move far slower
than jewellery placement does, so a slightly stale mask should still look correct most of
the time — rather than running it on every frame by default. This mirrors a pattern this
codebase already trusts (`TRACKING_DEGRADED_GRACE_MS` already lets jewellery coast on a
stale-but-recent transform rather than recomputing every frame).

`performance.ts`'s existing `PerformanceTracker` records only real, caller-supplied
`performance.now()` deltas and never fabricates a number — extending it to break out
per-stage timings (tracking / segmentation / geometry / shadow / composite, per the
original request's Phase 15) is a small, additive change to an already-correct pattern,
not a new subsystem.

**No FPS, latency, or "it works on mobile" claim in this document is a substitute for
real-device measurement.** Per the project's own established rule (and this session's own
recent history with the reverted shadow attempts), every stage above must be verified on
real desktop Chrome, mobile Safari, and mobile Chrome — with a screenshot or short
recording checked against real, before being called done — not inferred from a benchmark
run on different hardware.

## 9. Shadow strategy (and why the last three attempts specifically failed)

`README.md`'s own "Known issues" section already records this: three Canvas 2D shadow
attempts were tried and fully reverted after real breakage —
`ctx.shadowColor/shadowBlur` behaving inconsistently under an active `scale()`/`rotate()`
transform (shadow effectively invisible), a manually-drawn silhouette that still looked
flat, and `globalCompositeOperation: "source-atop"` masking against the *entire* existing
canvas content rather than just the jewellery sprite's own local draw (a solid gray block
covering the whole frame). All three failures share one root cause: **the shadow was
composited directly onto the same, already-transformed, full-frame canvas the video and
jewellery were drawn on**, so any global compositing-mode change or transform-state
assumption bled into content the shadow was never meant to touch.

**Proposed fix, structurally different from all three prior attempts:** render the shadow
on its own small offscreen canvas, sized to just the jewellery sprite plus a shadow
margin — never the full video-sized canvas. Do the translate/rotate/scale and shadow
synthesis (a soft, alpha-reduced silhouette of the sprite, offset slightly toward the
body, blurred via `ctx.filter = "blur(Npx)"` on that isolated buffer) entirely inside that
offscreen canvas, with no `globalCompositeOperation` changes ever applied to the main
canvas. Then composite that one finished offscreen result onto the main canvas with plain
`source-over`, positioned at the sprite's on-screen location, before drawing the jewellery
itself on top. Because the shadow never shares a drawing surface with the video frame,
neither of the first two failure modes (transform-dependent `ctx.shadow*`, whole-canvas
masking) can recur by construction — not because this time will be more careful, but
because the isolation removes the shared state each failure depended on. This still must
be verified on a real device after this one specific change, before any further phase is
attempted — not batched with other changes the way the last three attempts were.

## 10. Lighting strategy

Deferred. The original request's lighting phase (scene-luminance sampling, jewellery
brightness matching) is real, achievable work, but it depends on occlusion and shadow
already being correct and verified first (matching the original request's own phase
ordering) — attempting it earlier risks the same "guess, break, revert" cycle already
experienced with shadows, now compounded across two unfinished features instead of one.
No specific model or technique is recommended here yet; this should be scoped after §6/§9
ship and are verified on real devices.

## 11. Material (metal/gold) appearance strategy

Deferred, and likely low-priority relative to occlusion/shadow. The catalogue's asset
pipeline produces exactly one flat, already-lit RGBA PNG per jewellery item today
(`original`/`processed`/`thumbnail` — confirmed in `db/models/jewellery_asset.py`); there
is no albedo/roughness/metallic/normal data, and producing it would require re-processing
every catalogue asset through a new pipeline stage. This is a real, larger asset-pipeline
investment (§12) that should only be taken on once occlusion, shadow, and (optionally)
perspective are shipped and are themselves judged insufficient — a correctly-occluded,
correctly-shadowed flat gold PNG is very likely to already read as "worn" for most
customers without needing per-pixel material rendering on top.

## 12. Asset pipeline strategy

**No schema or reprocessing changes are needed for occlusion (§6) or shadow (§9).** Both
techniques operate on the existing alpha-channel-cutout PNG and the existing
`anchor_x`/`anchor_y`/`attachment_point`/`mirrorable` columns (`db/models/jewellery_asset.py`,
added in the Milestone 4 migration `20260919_0004`) — nothing new needs to be computed
per catalogue asset. A future perspective phase (§13) could optionally benefit from a
richer asset representation (e.g., a small set of pre-rendered rotation variants, or a
lightweight depth/normal hint per asset) but that is speculative and should not be built
ahead of actually needing it. **Recommendation: do not touch the asset pipeline or run any
new Alembic migration for this phase of work.**

## 13. Perspective (head-pose) strategy

**A real head-pose signal is already available and unused.** MediaPipe's `FaceLandmarker`
supports an `outputFacialTransformationMatrixes` option (`vision.d.ts:708`, confirmed in
the exact package version already installed) that returns a per-frame 4x4 transformation
matrix per detected face — a real yaw/pitch/roll signal, not a heuristic — and it is
currently `undefined`/off in `tracking.ts`'s `FaceLandmarker.createFromOptions(...)` calls
(confirmed by grep — neither `outputFaceBlendshapes` nor
`outputFacialTransformationMatrixes` is set today). Turning this on and feeding head
yaw/roll into `geometry.ts`'s earring/necklace rotation and scale (e.g., foreshortening an
earring's apparent width as the head turns) is a comparatively small, high-value addition
that requires no new model, no new network fetch, and no renderer change — only decoding
a matrix already computable by a model already loaded. This should be scoped as its own
phase, after occlusion/shadow, and explicitly labeled "2.5D" rather than "3D" in any
customer-facing or internal claim, per the original request's instruction to use
terminology honestly.

## 14. AI / generative-model boundary

No generative or diffusion model is proposed anywhere in this document, in the live loop
or otherwise — consistent with `docs/production-readiness.md`'s existing risk #4
("scope creep into generative AI too early, re-introducing the identity-preservation
problem") and with this project's already-settled position (see the prior conversation
in this repository's history) that a live, per-frame generative render is not currently
feasible at interactive latency and is out of scope. If a future optional post-capture
"AI polish" pass is ever pursued, it belongs only on a single captured frame (never the
per-frame loop), only with a commercially-licensed model, and only after being run through
this project's evaluation harness against the geometry baseline — exactly as
`docs/production-readiness.md` already requires.

## 15. Licensing findings (summary)

| Model | Used for | License status | Blocker |
|---|---|---|---|
| FaceLandmarker / PoseLandmarker (Tasks API) | Existing tracking | Apache-2.0, commercial use "Yes" (`ai/models/LICENSES.md`) | None — already shipped in production |
| ImageSegmenter, multiclass selfie segmenter (Tasks API) | Proposed occlusion (§6) | Apache-2.0, commercial use "Yes" (`ai/models/LICENSES.md`) | None in production; was sandbox-network-blocked only in this dev environment, not in real browsers |
| Depth Anything V2 (small/base) | Not proposed this phase (§5) | Apache-2.0 for small/base, but **verify per specific checkpoint** — some releases carry a separate non-commercial research license (`docs/model-comparison.md`) | N/A — out of scope |
| Any generative/diffusion VTON model | Not proposed anywhere in this document | Mostly CC BY-NC-SA (non-commercial) for the placement-capable models already surveyed | N/A — out of scope, see §14 |

Action item if §6 is approved: add a row for the multiclass `ImageSegmenter` model to
`ai/models/LICENSES.md` before wiring it into any browser code, per this project's own
standing rule that no model may be used without a corresponding registry row.

## 16. Files that would need modification (§6/§9/§13 scope only — no other phase)

- `apps/web/src/lib/live-ar/tracking.ts` — load `ImageSegmenter`; optionally enable
  `outputFacialTransformationMatrixes` on the existing `FaceLandmarker`.
- `apps/web/src/lib/live-ar/types.ts` — add types for the segmentation mask result and
  (if pursued) the facial transformation matrix.
- `apps/web/src/lib/live-ar/geometry.ts` — consume landmark `.z` for occlusion ordering;
  optionally consume head-pose matrix for rotation/scale (§13, separate follow-up phase).
- `apps/web/src/lib/live-ar/renderer.ts` — add the hair/clothing matte compositing step
  (§6) and the isolated offscreen-canvas shadow (§9); `drawJewelleryOverlay`'s existing
  signature and the video-then-jewellery draw order are extended, not replaced.
- `apps/web/src/lib/live-ar/constants.ts` — new tunables (segmentation update cadence,
  shadow offset/blur radius/opacity), following the file's existing documented-constant
  convention.
- `apps/web/src/components/live/useLiveArSession.ts` — wire the segmentation cadence into
  the existing RAF loop; this is the one place per-frame allocation (already unmanaged
  today — confirmed no pooling exists) should be revisited so segmentation mask buffers
  are reused rather than freshly allocated every update.
- `apps/web/src/lib/live-ar/performance.ts` — per-stage timing breakdown (tracking /
  segmentation / geometry / shadow / composite), additive to the existing tracker.
- `ai/models/LICENSES.md` — new row for the multiclass segmenter (§15).
- New test files alongside each touched module, following this codebase's existing
  1:1 file-to-test-file convention (e.g. a new `renderer.test.ts` case per compositing
  stage, a new `geometry.test.ts` case for z-based occlusion ordering).

Explicitly NOT touched by this phase: `apps/api/*`, any Alembic migration, `workers/*`,
`ai/geometry/*` (Python) or `ai/segmentation/*` — this is a browser-only, Live-AR-only
change, matching the original request's own architecture constraint that the live loop
must stay browser-local and the backend must not be put in the per-frame path.

## 17. Recommended implementation order

Numbered to match the milestone structure requested, adjusted where the evidence above
changes what a given milestone actually needs to research vs. already knows:

- **M6.1 — Rendering architecture audit.** This document.
- **M6.2 — Landmark z wired into geometry as a depth signal** (§5), with a unit test
  proving occlusion-ordering decisions against hand-built landmark fixtures (no camera
  needed for this step — pure function logic, testable today).
- **M6.3 — Occlusion proof of concept**: load `ImageSegmenter` multiclass, render its
  categoryMask to an offscreen canvas as a visual debug overlay only (no compositing
  into the live jewellery layer yet) — verified on a real device/camera before proceeding,
  specifically to get a real (not benchmark-borrowed) FPS number for this model on this
  app's actual per-frame budget.
- **M6.4 — Occlusion integrated**: the hair/clothes matte composited over the jewellery
  layer (§6), cadence-throttled per §8, verified on a real device against necklace and
  earrings both.
- **M6.5 — Contact shadow**, isolated-offscreen-canvas technique (§9), one real-device
  check after this single change before anything else is touched.
- **M6.6 — Perspective**: enable `outputFacialTransformationMatrixes`, feed head yaw/roll
  into earring/necklace rotation and scale (§13), verified on real device rotation tests.
- **M6.7 — Performance panel extension** (§8) — per-stage timing breakdown, real numbers
  from M6.3–M6.6's actual devices, not estimated.
- **M6.8 — Production integration**: ship behind existing category gating, update
  `README.md`/`docs/live-ar-verification.md` with what was actually verified and on what
  hardware, exactly as every prior milestone in this repository has done.

Lighting (§10) and material appearance (§11) are deliberately left unscheduled — they
should be scoped only after M6.4/M6.5 ship and are judged (by the user, on a real device)
to still be insufficient.

## 18. Risks

- **Mobile performance is the single biggest open risk**, specifically the multiclass
  segmenter's per-inference cost (§8) stacked on top of already-running face+pose
  tracking. This is why M6.3 is a standalone, camera-verified proof of concept before any
  compositing work — if real-device FPS is unacceptable even at a throttled cadence, §6
  needs a fallback (the cheaper binary `PoseLandmarker` mask, or dropping segmentation on
  low-end devices via feature/perf detection) decided with real numbers, not assumed.
- **Repeating the shadow failure pattern** if M6.5 is batched with other changes instead
  of tested in isolation, exactly as this project's own README now documents happening
  three times already.
- **Scope creep toward "3D"/"photorealistic" claims** the implementation can't back up —
  this document's own success criteria (§19) explicitly rule out this framing.
- **The `@mediapipe/tasks-vision` npm package (1.0.1) vs. the WASM fileset CDN pin
  (0.10.14) version mismatch**, already present in `tracking.ts` today and never
  exercised against a live network in this development sandbox. It has evidently worked
  in the real production deployment (Live AR ships today), but adding a second model
  (`ImageSegmenter`) is a reasonable moment to also pin the CDN fileset version to match
  the installed package, closing this pre-existing inconsistency rather than building on
  top of it silently.

## 19. What's achievable with current jewellery assets vs. what more would eventually be needed

**Achievable today, with zero catalogue reprocessing:** occlusion (§6) and contact shadow
(§9) both operate purely on the existing alpha-cutout PNG and existing anchor metadata —
every jewellery item already in the catalogue can use both the moment the code ships.
Perspective (§13) is also asset-independent — it only changes how the existing sprite is
transformed, not the sprite itself.

**Would eventually require new asset data, only if pursued:** true material/lighting
rendering (§11) would need per-asset albedo/roughness/metallic data the catalogue doesn't
capture today, and a 2.5D-layered or mesh-based jewellery representation (§ "possible
approaches" in the original request) would need a new asset-processing stage entirely.
Neither is recommended in this phase (§16 above), and neither should be built specula-
tively ahead of occlusion/shadow/perspective being shipped and judged against real
customer reaction.

## 20. Success criteria (restated, honestly)

This milestone succeeds when jewellery visibly changes from "a flat image floating over
the camera" to "an object that occludes correctly behind hair/clothing and casts a small
local shadow" — verified on a real device, not a screenshot guessed at from a description.
It does not require, and this document does not claim it will deliver, true 3D rendering,
photorealistic material rendering, or parity with a diffusion-based generative try-on
product. What is and is not achieved will be documented in
`docs/live-ar-realism-verification.md` (to be created alongside implementation, following
this codebase's existing verification-doc convention) exactly as every prior milestone's
claims have been — no number or capability claimed without a real, reproducible check
behind it.

---

**This document stops here, per the instruction that produced it: no implementation has
been started. M6.2 (§17) is the smallest, lowest-risk, most independently-testable next
step if this plan is approved — it needs no camera, no new model, and no real-device
verification to implement and unit-test, only real-device verification once it is
actually wired into the live compositing path in M6.4.**

## Sources

- [Image segmentation guide — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) — multiclass model classes, hosting URL, Pixel 6 CPU/GPU latency benchmark.
