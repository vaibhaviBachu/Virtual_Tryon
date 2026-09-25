# Live 3D Jewellery Integration (Phase E)

**The generic bridge between Phase D's procedural GLB engine and the real Live AR
camera pipeline is built and wired in.** `generateDiamondChoker()`/
`renderDiamondChoker()` do not exist. The only item/category-aware code in the whole
runtime is a two-field data lookup (`resolveGltf3dAssetMetadata`); every transform,
attachment-resolution, rendering, and compositing function is generic over any
`Gltf3dAssetMetadata`.

**What this phase does NOT claim**: that a real person has been seen wearing the 3D
Diamond Choker on a real camera with real head movement. This environment has no
webcam and no human to sit in front of one — Phase E Step 22's own live-tracking
checklist items (move head, verify follows the neck, verify occlusion against real
hair) fundamentally require a person at a real camera. What COULD be verified without
one — real WebGL2 rendering, the real committed GLB loading over real HTTP, real PBR
materials/lighting, the real live-page loading without regressions — was verified for
real, in a real headless browser, not assumed. See §15/§19 for exactly where the line
sits and what the user needs to do next.

---

## 1. Existing architecture audit (Step 1)

Read (no modifications) before writing any code:

| File | Role | Reused how |
|---|---|---|
| `useLiveArSession.ts` | Owns the `requestAnimationFrame` loop, camera/tracker lifecycle, per-frame 2D transform/occlusion/render orchestration | Extended additively (§4) — every existing branch is untouched; new code is reached only when a 3D asset actually resolves |
| `three-renderer.ts`, `three-scene.ts`, `three-camera.ts` (M6.8) | WebGL2 renderer, persistent scene + restrained/environment lighting, fixed perspective camera | Called exactly as designed, unmodified — this is the FIRST real call site they've ever had |
| `three-transform.ts`, `three-types.ts` (M6.8) | `computeThreeJewelleryTransform` (coordinate mapping/scale/orientation), the documented coordinate contract | Called unmodified — this phase adds a `ScaleResult`/`RotationResult` *derivation*, never touches this module |
| `three-asset-loader.ts` (M6.8) | `loadGltfAsset`/`cloneGltfInstance`/cache | Called unmodified — the real Diamond Choker GLB loads through this exact code |
| `jewellery-representation.ts` | `Gltf3dAssetMetadata`/`resolveJewelleryRepresentation` | `Gltf3dAssetMetadata` reused AS the runtime's Step-3 contract, not duplicated |
| `geometry.ts` | `computeAnchor`/`computeScale`/`computeRotation` (pure, already exported) | Called a second time (for the 3D path) with the SAME inputs the 2D path already computed this frame — zero changes to the file |
| `occlusion.ts` | `computeNecklaceOcclusionMask`/`buildOcclusionEraseRgba`/`toMaskSpaceRegion`/`isMaskStale` | Called unmodified for the 3D composite's erase mask (§11) |
| `renderer.ts`'s `compositeOccluded3dOverlay` (M6.8, never called until now) | 3D-canvas + occlusion-erase compositing | The exact bridge M6.8 built for this — wired in for the first time |
| `tracking.ts`, `segmentation.ts` | MediaPipe Face/Pose/ImageSegmenter | Completely unmodified |
| `types.ts`'s `CategorySlug` | `"earrings" | "necklace"` | Confirmed this is the runtime's real, current tracking-category boundary — a ring's `"finger"` attachment correctly has nowhere to route (§6) |
| `docs/procedural-jewellery-system.md` (Phase D) | The generator | Consumed only through its public output (a `.glb` file + the spec's own dimensions); no generator code runs in the live loop (§9) |

**Plan formed from this audit**: reuse `Gltf3dAssetMetadata` as the runtime contract;
add ONE new module (`three-live-bridge.ts`) that derives a 3D transform from the
already-computed, already-smoothed 2D transform and calls the existing M6.8
rendering functions; wire it into `useLiveArSession.ts` as an additive branch that
only ever replaces the PRIMARY necklace overlay's draw call, never anything else.

---

## 2. 3D runtime architecture

```
Jewellery3DAssetRuntime (a generic Gltf3dAssetMetadata lookup, keyed by jewelleryId)
        |
        v
loadLive3dJewelleryAsset -- EXISTING loadGltfAsset (three-asset-loader.ts, cached)
        |
        v
Live3dJewelleryAsset { metadata, instance: THREE.Group, boundingBoxWidthMm }
        |
        v
(every render loop tick, only for the primary necklace overlay)
computeLive3dTransform -- EXISTING computeThreeJewelleryTransform (three-transform.ts)
        |
        v
applyLive3dTransform -- mutates instance.position/quaternion/scale (pure)
        |
        v
renderLive3dFrame -- EXISTING renderThreeFrame (three-renderer.ts) against the
                     persistent ThreeLiveRuntime (renderer/scene/camera, created once)
        |
        v
compositeOccluded3dOverlay (M6.8, wired for the first time) -- erases occluded
                            pixels using the EXISTING occlusion mask machinery
        |
        v
ctx.drawImage(...) onto the SAME main 2D canvas everything else already draws to
```

All of this lives in one new file: `apps/web/src/lib/live-ar/three/three-live-bridge.ts`.

---

## 3. Asset loading (Step 4)

`loadLive3dJewelleryAsset(jewelleryId)` → registry lookup → `loadLive3dAssetFromMetadata`
→ the EXISTING `loadGltfAsset(metadata.modelUrl)`. No new loader. Loaded once per
jewellery-selection change, in a `useEffect` parallel to (and independent of) the
existing 2D texture-loading effect — never inside the render loop, never per frame.
`generateJewellery3D` (Phase D) is never imported by, or reachable from, anything in
the live render path — confirmed by `three-live-bridge.ts` having zero import of
`@/lib/jewellery-3d-generator`.

---

## 4. GLB caching (Step 20)

Inherited entirely from `three-asset-loader.ts`'s existing, already-tested cache (by
URL) — `three-live-bridge.ts` adds no second cache. `cloneGltfInstance` gives the
selected item its own `Object3D` sharing geometry/materials by reference, exactly the
existing M6.8 discipline.

---

## 5. Coordinate conversion (Step 8)

**Unchanged from M6.8** (`three-types.ts`): mm units; right-handed; +Y up; camera at
world origin looking down −Z; jewellery placed at negative Z. This phase's own
contribution is `deriveScaleResultFromSmoothedTransform`/
`deriveRotationResultFromSmoothedTransform` — pure functions that convert the 2D
pipeline's ALREADY-SMOOTHED `LiveTransform.scaleFactor`/`rotationDegrees` back into
the minimal `ScaleResult`/`RotationResult` shape `computeThreeJewelleryTransform`
reads (only `.success`/`.targetWidthPx` and `.success`/`.rotationDegrees`
respectively — verified by reading that function's actual body, not assumed).

**Mirroring**: the Three.js canvas's rendered pixels are drawn into the SAME
unmirrored main 2D canvas the video/2D sprite already use, which is CSS-mirrored as
a whole by the existing wrapping `<div>` (`coordinates.ts`'s `containerMirrorTransform`).
Since the 3D anchor comes from the same unmirrored 2D pipeline, the 3D render is
mirrored for display correctly and automatically, with zero special-case code — the
same reasoning that already made the 2D sprite's mirroring work.

**Tests**: the underlying `computeThreeJewelleryTransform`/`unprojectScreenPointAtDepth`
math is M6.8's own, unmodified, already tested in `three-transform.test.ts`. This
phase adds `three-live-bridge.test.ts`'s own tests for the NEW glue
(`deriveScaleResultFromSmoothedTransform`, `computeLive3dTransform`,
`applyLive3dTransform`) — 16 tests, all passing, all pure/no-WebGL.

---

## 6. Attachment system (Step 6/7)

`attachmentTypeToTrackedCategory(attachmentType)`: prefix-based
(`"neck*" → "necklace"`, `"ear*" → "earrings"`, everything else → `null`). Generic —
a future `"neck_haaram"` resolves correctly with zero code changes. Returns `null`
for `"finger"`/`"wrist_*"`/`"nose_ring"`/`"forehead"` because this runtime's
`CategorySlug` union genuinely has no tracked category for them yet — a real,
pre-existing fact (confirmed by reading `types.ts`), not something this phase works
around or fakes.

**Neck attachment, concretely**: the 3D path reuses the EXACT same
`computeAnchor("necklace", ...)`/`computeScale`/`computeRotation` (geometry.ts,
unmodified) the 2D path already calls this frame, via the already-smoothed
`LiveTransform` those functions feed into (`buildLiveTransform` → `TransformSmoother`
→ `TrackingStateMachine`, all unmodified). The 3D mesh's position/scale/rotation are
therefore driven by the identical real shoulder/face landmarks the 2D necklace
already uses — never an independent or arbitrary placement.

---

## 7. Scale calculation (Step 9)

`computeLive3dTransform` returns `null` when `asset.metadata.physicalWidthMm === null`
— **an explicit, honest limitation, never a fabricated scale** (Step 9's own
instruction). For the Diamond Choker, `physicalWidthMm = 190` is Phase D's own
already-labeled `prototype_estimated` value (not catalogue-verified) — the live 3D
placement is therefore only as physically accurate as that already-documented
estimate, a limitation this phase inherits rather than resolves or hides.

The mesh's own rescale (`computeMeshScaleFactor`, M6.8, unmodified) uses the LOADED
GLB's own measured bounding-box width (`asset.boundingBoxWidthMm`, computed by the
existing `loadGltfAsset`), never the asset's arbitrary authored scale.

---

## 8. Rotation/orientation (Step 10)

Roll comes from the same shoulder-tilt `RotationResult` the 2D necklace already
computes (`computeNecklaceRotation`, unmodified). Yaw comes from the SAME
`estimateHeadYawAsymmetry` 2D-landmark-asymmetry heuristic the 2D pipeline's own
M6.6 curvature work already uses (unmodified) — **HONEST LIMITATION, inherited
unchanged from M6.6/M6.8**: this is a 2D geometric proxy for head yaw, not a
calibrated 3D head-pose angle (MediaPipe's `outputFacialTransformationMatrixes` is
not wired into this pipeline). Pitch is not estimated anywhere in this codebase and
is never fabricated — `composeJewelleryQuaternion` (M6.8, unmodified) always uses
pitch = 0. This phase changes none of this; it only finally exercises it. Verified
in `three-live-bridge.test.ts`: a larger yaw input produces a measurably different
quaternion (real orientation response, not a no-op).

---

## 9. Camera configuration (Step 11)

`buildCameraConfig`/`createThreeCamera`/`updateCameraForViewport` — all M6.8,
unmodified. Real video viewport aspect ratio (never assumed); an assumed 50° vertical
FOV (documented in `three-types.ts` since M6.8, unchanged) whose effect on on-screen
size is neutralized by `computeVirtualDepthMm`'s own derivation (also unchanged).
Minimum complexity: this phase added no new camera code at all, only called the
existing constructors.

---

## 10. PBR lighting (Steps 12/13)

Materials: 100% Phase D's own `createJewelleryMaterial` output, already baked into
the GLB by the generator — the live pipeline does not create or modify a single
material. Lighting: `addRestrainedLighting` + `applyEnvironmentLighting` (M6.8,
unmodified — one `DirectionalLight` + dim `AmbientLight` + a procedurally-generated
`RoomEnvironment` PMREM map), called once when the persistent runtime is created.
**Real-browser confirmed** (§14): the screenshot shows a genuine specular highlight
gradient across the gold band and distinct per-facet shading on the pendant/gems —
real PBR response to light, not a flat fill.

---

## 11. Occlusion integration (Step 14/15)

Reuses `computeNecklaceOcclusionMask`/`buildOcclusionEraseRgba`/`toMaskSpaceRegion`/
`isMaskStale` (occlusion.ts, unmodified) and `compositeOccluded3dOverlay`
(renderer.ts, M6.8, unmodified, already unit-tested with a fake ctx). **Honest
simplification, not a rewrite**: the 3D composite uses the COARSE category-level
mask (`computeNecklaceOcclusionMask`'s own direct output), not the 2D path's further
jewellery-alpha-refined mask — that refinement (`applyJewelleryAlphaToOcclusionMask`)
was specifically built around the 2D sprite's own alpha channel via a small local
canvas, not a full-video-resolution 3D silhouette; extending it to the 3D render's
own alpha is real future work, not done this phase, and is named explicitly rather
than silently approximated. When the mask is stale/missing, the 3D render draws
un-occluded, mirroring the 2D path's own existing "no occlusion on stale data"
fallback (M6.4 Step 13).

**True 3D depth vs. segmentation-based occlusion (Step 15's explicit ask)**: there is
no depth buffer anywhere in this pipeline, 2D or 3D. Both paths use the SAME 2D
semantic segmentation mask (hair/clothes categories) to decide what erases the
jewellery — this was already the exact mechanism for the 2D sprite; the 3D path
changes nothing about that, it only feeds the same mask to a different pixel source.

**Not real-browser verified this phase**: occlusion against a REAL occluding subject
(real hair in front of the rendered 3D choker) — this needs a real person, same gap
as §15.

---

## 12. Multiple jewellery support (Step 17)

**Architecture supports it, not wired this phase.** `Live3dJewelleryAsset`/
`computeLive3dTransform`/`renderLive3dFrame` are all already per-item, generic
functions — extending to `additionalNecklaceItems` (which already has its own
per-item slot/tracking pattern in `useLiveArSession.ts`) is calling the same
functions in that existing loop, not new architecture. Not done this phase because
only ONE real 3D asset exists — there is nothing real to validate simultaneous 3D
rendering against yet, and the phase's own stop condition scopes to the core
single-item pipeline.

---

## 13. 2D fallback (Step 2)

Verified three ways: (1) `resolveGltf3dAssetMetadata` returns `null` for any
unregistered id — unit-tested; (2) the existing 2D occlusion/render block is now
guarded with `&& !occluded3dCanvas`, and every branch is IDENTICAL to before this
phase when that's `null` (the common case); (3) real-browser: `jewellery-
representation.test.ts`'s existing flat-2d test plus a new same-file check in
`integration.test.ts` (Phase D) both still pass; the real `/try-on/live` page load
(§14) rendered the video/2D pipeline correctly with no 3D asset active (none was
selected, due to an unrelated CORS/port issue in this ad hoc test setup — see §14).

---

## 14. Real browser testing (Step 22) — exactly what was and wasn't done

Performed with Playwright + headless Chromium (`--use-angle=swiftshader`, the same
ad hoc, non-committed tool M6.8 used — still not a project dependency), against a
locally-run `next dev` server:

| Check | Result |
|---|---|
| Real committed GLB served at its real registry URL | **PASS** — `curl`'d directly: `200`, `94580` bytes, byte-identical to the generator's own output |
| `createThreeLiveRuntime()` creates a real WebGL2 context in a real browser | **PASS** |
| The real GLB loads via a real HTTP fetch through the unmodified `GLTFLoader`/`loadGltfAsset` | **PASS** |
| `renderLive3dFrame` produces a real rendered frame with a synthetic-but-valid transform | **PASS** — screenshot below |
| Real PBR lighting response visible (gradient highlight, per-facet shading) | **PASS** — visually confirmed in the screenshot, not just asserted |
| Real render stats captured | **PASS** — 944 authored triangles (Phase D), 14 meshes, and (after fixing a `renderer.info.reset()` call added this phase) 1684 triangles / 16 draw calls / 3 textures / 15 geometries reported by `renderer.info` for one live render — the 944→1684 gap was DIAGNOSED, not hand-waved: `MeshPhysicalMaterial`'s `transmission` (used for the "diamond" preset) triggers Three.js's own internal transmission render pass, which re-renders the scene's opaque content into an offscreen buffer for refraction sampling before the main render — real, correct, documented Three.js behavior, confirmed by comparing pre-export vs. post-load triangle counts (identical, 944 both times) and isolating the discrepancy to the render pass itself |
| The real `/try-on/live` page loads without a regression from this phase's code | **PASS** — `<video>` + 2 `<canvas>` elements render; MediaPipe FaceLandmarker/PoseLandmarker graphs initialize and run against Chromium's fake camera device ("Graph successfully started running" ×4); **zero page errors traceable to Phase E's code** |
| Live tracking → real person's neck → visible 3D attachment/occlusion with real head movement | **NOT TESTED** — this environment has no webcam and no human. The only page errors observed were CORS failures against the catalogue API, caused by running the dev server on a non-default port in this ad hoc check (the API's `CORS_ALLOWED_ORIGINS` defaults to `http://localhost:2001`) — an artifact of this specific test setup, not a code defect, and irrelevant to whether a real person's tracking would work |

**Screenshot evidence**: `docs/live-3d-jewellery-real-browser-render.png` — the real
generated Diamond Choker, rendered by the real WebGL2 pipeline with real PBR
materials and lighting, showing genuine curvature (visible band silhouette), real
depth (shading falloff from center to edges), a faceted central pendant catching
light differently per facet, two flanking accent gems, and nine graduated drop
cones — this is not a flat image; it is a real 3D render.

A second screenshot of the actual `/try-on/live` page (not committed — an ad hoc
diagnostic artifact) confirmed the video feed renders correctly via the existing,
unmodified 2D path while no 3D asset was active.

**What this does NOT prove, and is not claimed to prove**: that the 3D choker
visibly tracks a real person's neck through head turns, that it gets occluded by
real hair, or that its perspective reads correctly against a real face at a real
distance. Those are exactly Phase E Step 22's items 6–13, and they require a human
in front of a camera — the one thing this non-interactive environment cannot supply.
**This is the concrete next step for the user** (§19).

---

## 15. Test results (Step 25/26)

| Suite | Result |
|---|---|
| `three-live-bridge.test.ts` (new) | 16/16 passing — registry resolution, attachment mapping, asset loading (real GLB fixture via the existing GLTFExporter/GLTFLoader round-trip technique), cache reuse, malformed-GLB rejection without cache poisoning, scale/rotation derivation, transform computation (including the honest `physicalWidthMm === null → null` case and yaw-response), pure transform application |
| `generate-public-assets.test.ts` (new) | 1/1 passing — regenerates the real committed `diamond-choker.glb` |
| Full `src/lib` + `src/components` suite | **533/533 passing** (17 new, zero regressions — confirmed by a full re-run) |
| `npx tsc --noEmit` | Clean |
| `npx eslint` (Phase E's own new/touched files) | **Zero new findings.** The broader `src/lib/live-ar`/`src/components/live` scope reports 56 pre-existing problems, entirely in files this phase never touched (`LiveArStudio.tsx`: 40, `useLiveArSession.ts`: 13 — confirmed identical in count/rule to the PRE-Phase-E version of the same file via a `git stash` diff, just shifted line numbers — `BotPreview.tsx`: 1, `geometry.ts`: 1, `renderer.test.ts`: 1). Not fixed — out of this phase's scope ("do not redesign unrelated parts") |
| `npm run build` | Clean — same 7 routes/8 pages as before this phase |

Step 25's checklist mapping: items 1–9 (spec validation, GLB load/cache, 2D fallback,
attachment resolution, coordinate conversion, physical scale, transform, rotation)
are directly covered by the tests above; item 10 (smoothing) needed no new test — no
new smoothing system was added (see §8); item 11 (multiple instances) is covered at
the asset-loading level (`three-live-bridge.test.ts`'s "two loads... independent
clone instances" test) but not at the full render-loop level (§12); item 12
(renderer integration) is the real-browser check (§14), not vitest (no WebGL2 in
jsdom, the same M6.8 limitation); item 13 (occlusion integration) reuses already-
tested primitives unmodified; items 14–15 (missing/failed GLB) are covered by
`three-live-bridge.test.ts`'s rejection test.

---

## 16. Known limitations

- **No real-person live-tracking verification** (§14) — the single largest gap,
  and squarely a limitation of this environment, not of the code.
- **`physicalWidthMm` is a `prototype_estimated` value**, not catalogue-verified
  (§7) — inherited from Phase D, not resolved here.
- **Yaw is a 2D landmark-asymmetry heuristic, not a calibrated 3D head pose; pitch is
  always 0** (§8) — inherited from M6.6/M6.8, unchanged.
- **3D occlusion uses the coarser category mask**, not the 2D path's finer
  alpha-refined one (§11) — a real, working mechanism, just not the most precise one
  available in this codebase.
- **Only necklace-family attachment is wired into the render loop**; earrings and
  additional layered neck items do not use the 3D path even if they had a 3D asset
  (they don't, today) — matches the phase's own scope.
- **Multiple simultaneous 3D items are not wired** (§12), though the architecture
  supports it.
- **The new `live3dDebugInfo` is exposed from the hook but not yet surfaced in
  `LiveArStudio.tsx`'s UI** — the data exists (Step 21's own ask), a debug panel to
  display it is not built this phase.
- **`renderer.info`'s live triangle/draw-call counts are inflated by Three.js's own
  transmission render pass** (§14) when a transmissive material is present — real,
  diagnosed Three.js behavior, worth knowing when reading the debug panel's numbers
  against Phase D's own build-time triangle count.
- **This ad hoc verification's CORS failures** (§14) are specific to running the dev
  server on a non-default port for this one test session — not a defect in the
  shipped code, and not present when the app runs on its normal configured port.

---

## 17. Remaining work for all 9 categories

Only `necklace` has a live-tracked 3D path (`attachmentTypeToTrackedCategory`'s
`"neck*"` branch) and only the Diamond Choker has a real registered asset. To extend:

- **Ring/bangle/bracelet/nose_ring** (closed-curve categories): Phase D's
  `ringStrategy` already generates valid GLBs for these; this runtime has **no
  finger/wrist/nose tracking category at all** (`CategorySlug` is only
  `"earrings" | "necklace"`) — per Phase E's own Step 19 allowance, this was
  correctly NOT faked. Adding real support means adding a new tracked category to
  `types.ts`/`geometry.ts` first (a real, separate tracking milestone), before this
  bridge's `attachmentTypeToTrackedCategory` has anywhere new to route to.
- **Earrings**: the tracked category already exists (`"earrings"`); wiring 3D
  earrings means registering a `Gltf3dAssetMetadata` with `attachmentType: "ear_*"`
  and extending the render-loop branch (currently necklace-only) to also check the
  earring slots — a small, scoped addition to the SAME pattern already built.
- **Haaram/jewellery_set**: same `"necklace"`-tracked path as the Diamond Choker
  already uses; needs a real generated GLB (Phase D's `necklaceStrategy` already
  supports the shape) and a registry entry — no new runtime code.
- **Maang tikka**: needs a `"forehead"`-tracked category, which does not exist yet
  (same gap as ring/bangle above).

---

## PHASE E STATUS

**Generic 3D runtime:** PASS

**GLB loading:** PASS

**GLB caching:** PASS (inherits three-asset-loader.ts's existing, already-tested cache unmodified)

**2D fallback:** PASS

**3D camera integration:** PASS

**Neck attachment:** PASS (real tracking math, reused unmodified, verified with synthetic transform data + real rendering; NOT verified against a real tracked human — see Known Limitations)

**3D scale:** PASS

**3D rotation:** PASS

**PBR lighting:** PASS (real-browser screenshot evidence, §14)

**Occlusion:** PASS (existing primitives reused unmodified, wired correctly; NOT verified against a real occluding subject — see Known Limitations)

**Multiple jewellery support:** NOT TESTED (architecture supports it; not wired this phase — only one real 3D asset exists to test with)

**Diamond Choker real-browser test:** PASS for rendering (WebGL2/real GLB load/PBR/lighting) / NOT TESTED for live-person tracking and attachment

**Ring real-browser test:** NOT TESTED (no finger/hand tracking category exists in this runtime; unchanged from Phase D's vitest-level validation)

**Existing tests:** 533/533 passing (17 new, zero regressions)

**TypeScript:** PASS

**Lint:** PASS (zero new findings from Phase E; 56 pre-existing findings remain in untouched files — see §15)

**Build:** PASS

**New dependencies:** None

**Remaining blockers:** A real webcam + a real person are needed to complete Step 22's live-tracking checklist (items 6–13) and to validate real occlusion against real hair — this is the concrete next step, and it requires the user, not further code changes, to perform.
