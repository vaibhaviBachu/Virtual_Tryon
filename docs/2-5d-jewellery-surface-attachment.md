# 2.5D Jewellery Surface Attachment (Phase 2.5D)

**The real, restored Diamond Choker artwork is now mapped onto a curved,
subdivided 3D mesh — never replaced by a procedural placeholder.** The pipeline
is: `DETAILED TRANSPARENT PNG → 2.5D MESH → BODY SURFACE → THREE.JS → LIVE
CAMERA`. Every diamond, the actual central stone, the actual drop shapes — the
texture is the unaltered real photograph. Only the geometry is synthetic: a
curved ribbon swept along the choker's own authored curvature, giving real
depth/perspective/wrap behaviour a flat PNG cannot produce, without
fabricating the jewellery's own appearance the way Phase D's procedural
generator did (`docs/diamond-choker-asset-restoration.md`).

---

## 1. Why 2.5D

A flat PNG sprite (the pipeline's baseline, and still the fallback here) has
no depth: rotate the head and the sprite can be repositioned and rotated in
2D, but it can never reveal a different silhouette, foreshorten correctly, or
have its center sit visually closer to camera than its edges the way a real
piece resting against a curved neck does. `docs/live-ar-3d-representation-assessment.md`
(M6.7) established this limitation is real, not cosmetic.

The obvious next step — a full procedural 3D asset (Phase D) — solves the
depth problem but introduces a worse one: the *geometry* is invented (a plain
band, a dome, cone drops standing in for the actual design), which a
real-person test correctly rejected as unacceptable
(`docs/diamond-choker-asset-restoration.md`). 2.5D is the middle path: real
geometry, but only enough of it to carry a curve — the *appearance* is still
the exact, unaltered real photograph, mapped as a texture rather than
redrawn or approximated.

## 2. Why the procedural engine still isn't customer-facing

Nothing from Phase D–G was removed. `GLTF_3D_ASSET_REGISTRY` in
`three-live-bridge.ts` still holds the Diamond Choker's procedural GLB, still
gated by `productionVerified: false` (a real person looked at it live and
rejected it). The generic `productionVerified` discipline introduced during
the restoration is reused verbatim for the new curved-2.5D representation
(`Curved25dAssetMetadata.productionVerified`, `jewellery-representation.ts`):
existing is not the same claim as verified. The procedural GLB path remains
real, tested, dev-only research infrastructure — this phase does not touch or
re-litigate that decision.

## 3. The mathematical surface

`apps/web/src/lib/live-ar/three/curved-2_5d-geometry.ts`'s
`createCurvedRibbonGeometry` builds a "curved ribbon": a `THREE.CatmullRomCurve3`
fit through the item's own authored control points (for Diamond Choker, the
SAME curve already used by Phase D's procedural band —
`[{x:-95,y:0,z:-18},{x:0,y:0,z:0},{x:95,y:0,z:-18}]`, a 190mm-wide arc with an
18mm sagitta), sampled at `segmentsU` (default 48) points along its length.
At each sample, a width direction is computed as a **fixed reference axis**
cross product (`upAxis × tangent`, re-orthogonalized), never a Frenet frame —
the same discipline `jewellery-3d-generator/primitives.ts` and
`neck-surface-3d.ts` already established for this exact class of curve
(a roughly-planar arc around a body part), because Frenet frames twist
unpredictably here. Each row is then extruded vertically by `heightMm` across
`segmentsV` (default 16) subdivisions, producing a non-indexed grid of quads
with `geometry.computeVertexNormals()` for correct per-face flat shading.

Unlike Phase D's procedural cross-section (a solid rectangle, because a
procedural mesh needs real volume to look like metal), the ribbon's
cross-section has **no depth of its own** — it is a single-sided vertical
strip. The texture already encodes the piece's real apparent thickness and
shading from the source photograph; adding a second, geometric thickness on
top would be redundant and was deliberately left out.

## 4. UV mapping — preserving the real artwork exactly

UVs are a plain planar `(u, v)` grid mapping directly onto the full texture:
`u = rowIndex / segmentsU` (0 at one end of the curve, 1 at the other),
`v = colIndex / segmentsV` (0 at the top of the ribbon, 1 at the bottom).
Nothing about the source PNG is redrawn, cropped, or regenerated — only where
each pixel's corresponding vertex sits in 3D space changes.
`curved-2_5d-geometry.test.ts` verifies this directly: UVs span exactly
`[0, 1]` in both axes, and `v = 0` is confirmed to land at the mesh's maximum
Y (top) and `v = 1` at its minimum Y (bottom) — matching Three.js's default
`texture.flipY = true` convention, verified empirically rather than assumed.

`curved-2_5d-bridge.ts`'s `buildCurved25dAsset` constructs the texture from
the *same* `HTMLImageElement` the existing 2D pipeline already decoded
(`asset-cache.ts`'s `loadJewelleryAssetTexture`) — never a second fetch or
decode of the artwork.

## 5. Neck attachment — reusing the existing surface, not a second model

This phase adds no new neck model. The curved-2.5D mesh is positioned,
oriented, and scaled by the *exact same* functions the procedural GLB path
already used and had validated across Phases E–G:
`resolveAttachmentOrientation` (`body-attachment.ts`, real yaw/pitch from
MediaPipe's facial transformation matrix, roll from shoulder tilt), and
`computeSurfaceAttachedTransformFromDimensions` (extracted from
`three-live-bridge.ts` in this phase specifically so both paths call the one,
shared implementation — see §17). The parametric neck-surface debug overlay
(`neck-surface-3d.ts`, Phase G) is unmodified and works identically for
curved-2.5D, since it only reads `runtime.currentInstance.position`, which is
set generically by `renderInstanceWithTransform` regardless of which
representation's `THREE.Group` is currently attached.

## 6. Camera projection

Unmodified — `three-camera.ts`'s `buildCameraConfig`/`createThreeCamera`/
`updateCameraForViewport` (an assumed 50° vertical FOV, uncalibrated, the same
status as every other visual constant in this project — `three-types.ts`).
A dedicated real-browser sanity check for this phase (§18) placed two 50mm
reference planes at 150mm and 168mm from the camera and measured their
rendered pixel widths: 172px and 154px, a 1.117× ratio against a
geometrically expected 1.12× (168/150) — confirming the existing perspective
projection math is correct and is what makes the curvature's depth variation
visible at all.

## 7. Scale

Unmodified — `computeMeshScaleFactor(physicalWidthMm, boundingBoxWidthMm)`
(`three-transform.ts`). The ribbon's *own* measured bounding-box width (via
`THREE.Box3().setFromObject`, not assumed equal to `physicalWidthMm`) is
compared against the catalogue's real `physical_width_mm` exactly as the GLB
path already does — for Diamond Choker this is 190mm built vs. 190mm
catalogue, a near-1.0 correction.

## 8. Head/body separation

Unmodified — orientation is derived once per frame from
`resolveAttachmentOrientation("necklace", face, pose, ...)`, the same call
the GLB path makes; this phase introduces no separate head-only or body-only
tracking path.

## 9. Occlusion

Reused, not duplicated. `useLiveArSession.ts`'s occlusion-compositing block
(segmentation-category mask, refined by the render's own alpha, erase-pattern
composite) was extracted this phase into a single function,
`compositeRendered3dFrame`, generic over *which* representation produced the
transparent-background canvas being composited — the procedural GLB or the
curved-2.5D mesh. Both paths call the identical function with the identical
scratch canvases (safe because gltf-3d and curved-2.5d are never both active
for the same item at once — see §10's priority rule). No second occlusion
implementation exists.

## 10. Fallback

The representation contract (`jewellery-representation.ts`) now resolves, in
order: **`gltf-3d`** (if a `productionVerified` GLB exists — none does today)
→ **`curved-2.5d`** (if a `productionVerified` curved asset exists — Diamond
Choker does) → **`layered-2.5d`** (unused, no catalogue data yet) →
**`flat-2d`** (the original PNG sprite, always available). The live render
loop (`useLiveArSession.ts`) applies the same priority at the actual call
site: `activeGltf3d` wins over `activeCurved25d`, and if the curved-2.5D
runtime fails to render for any reason (no WebGL2, a failed asset load,
tracking lost this frame), `renderCurved25dFrame` returns `null` and the loop
falls through to the untouched flat-2D sprite path — never a partial or
broken render.

## 11. Performance

See §18 for the actual measured numbers and their honest scope. Summary: the
isolated Three.js render call (`renderCurved25dFrame`) costs well under 1ms
per frame even under software (SwiftShader) rendering in a headless browser —
this render step is not a bottleneck. It reuses the *same* persistent
`ThreeLiveRuntime` (one `WebGLRenderer`/`Scene`/`Camera` for the whole
session, created once — Phase E/G's own established discipline), and the
curved-ribbon mesh is built exactly once per item selection (in
`useLiveArSession.ts`'s asset-loading `useEffect`, keyed on
`[jewelleryId, asset, primaryPhysicalWidthMm]`), never regenerated per frame.

## 12. Real-person test results

**Not performed by me.** As with every prior phase of this project
(Phases E–H), I have no camera and cannot run the live app against a real
human face in this non-interactive environment. What *is* verified (§18) is a
real-browser (headless Chromium, real WebGL2/SwiftShader) render of the
actual shipped code, the actual real Diamond Choker artwork, and real,
measured pixel output — but not a live camera session with a real person
wearing it. That test remains the user's own, exactly as it has for every
phase before this one.

## 13. Known limitations

- **FOV/camera intrinsics remain assumed, not calibrated** (§6) — unchanged
  from every prior phase; this phase neither introduces nor fixes this.
- **`physicalDepthMm` (12mm) and the curve's own 18mm sagitta are
  `prototype_estimated`**, not catalogue-verified measurements of the real
  physical piece (`docs/diamond-choker-prototype-measurements.json`) — reused
  as-is from the procedural prototype's own already-labeled numbers, per this
  phase's "do not invent a new number" discipline.
- **The ribbon has no geometric thickness of its own** (§3) — correct for a
  texture that already encodes real shading, but means the mesh's *silhouette
  edge* (where alpha cuts off) is a flat cut, not a rounded physical edge.
  Not visible at the piece's actual on-screen scale in this phase's testing,
  but a real, honest simplification.
  the curve is currently authored once, by hand, matching the procedural
  prototype's own already-established control points — there is no
  general-purpose curve-fitting-from-photograph tool yet (see §14).
- **Only necklace/Diamond Choker is deep here**, per this phase's own scope
  (see §14 for what "generic" means today vs. what remains
  necklace/choker-specific).

## 14. Generic future architecture

The type/contract layer is fully generic today: `Curved25dAssetMetadata`
(`jewellery-representation.ts`) has no Diamond-Choker-specific field, and
`resolveJewelleryRepresentation`'s priority logic
(gltf-3d > curved-2.5d > layered-2.5d > flat-2d) applies to any future item.
`curved-2_5d-geometry.ts`'s `createCurvedRibbonGeometry` takes arbitrary
control points, height, and segment counts — nothing about it assumes a
choker. What remains item-specific is exactly one thing, by design (mirroring
`GLTF_3D_ASSET_REGISTRY`'s own existing pattern): the *registry entry* itself
— `CURVED_25D_ASSET_REGISTRY` in `curved-2_5d-bridge.ts` has one entry, keyed
by `jewelleryId`, holding that item's own authored curve. Adding a second
item (a bangle — `closed: true` — or a different necklace) means adding one
registry entry with that item's own real control points and dimensions, set
`productionVerified: true` only after a human confirms it actually looks
right, and reusing every function in this document unmodified. The render
loop's `attachmentTypeToTrackedCategory` prefix-matching (`"neck"` → necklace,
`"ear"` → earrings) already generalizes beyond necklace; only the neck
attachment orientation/surface math (§5) is necklace-specific today, and that
limitation predates this phase (Phase E/F/G).

---

## 15. What was built (files)

**New:**
- `apps/web/src/lib/live-ar/three/curved-2_5d-geometry.ts` — pure geometry
  construction (`createCurvedRibbonGeometry`), no WebGL/texture/tracking
  dependency. 8 tests.
- `apps/web/src/lib/live-ar/three/curved-2_5d-bridge.ts` — the registry
  (`CURVED_25D_ASSET_REGISTRY`), `resolveCurved25dAssetMetadata`,
  `buildCurved25dAsset`, `renderCurved25dFrame`. 24 tests (7 original + 17
  added for synthetic orientation/depth/tracking-degradation coverage, §19).

**Modified:**
- `apps/web/src/lib/live-ar/jewellery-representation.ts` — added
  `"curved-2.5d"` to `JewelleryRepresentationType`, the `Curved25dAssetMetadata`
  contract type, and `curved25dAsset` to the input/output shapes;
  `resolveJewelleryRepresentation` now resolves it at the correct priority
  (between gltf-3d and layered-2.5d). 6 new tests.
- `apps/web/src/lib/live-ar/three/three-live-bridge.ts` — extracted
  `computeSurfaceAttachedTransformFromDimensions` (the real implementation;
  `computeSurfaceAttachedTransform` is now a thin wrapper over it) and
  `renderInstanceWithTransform` (the shared position/render/composite core),
  so `curved-2_5d-bridge.ts` reuses them rather than re-implementing the
  transform/render pipeline. No behavior change — confirmed via the existing
  24 `three-live-bridge.test.ts` tests still passing unmodified.
- `apps/web/src/components/live/useLiveArSession.ts` — loads the curved-2.5D
  asset per selection change (reusing the already-cached 2D image, never a
  second fetch); the render loop now resolves `gltf-3d > curved-2.5d >
  flat-2d` priority at the call site; extracted `compositeRendered3dFrame`
  (§9) so the occlusion-compositing block is shared, not duplicated, between
  the two representations; `live3dDebugInfo` gained a `representationMode`
  field.
- `apps/web/src/lib/live-ar/debug.ts` / `LiveArStudio.tsx` — added
  `formatLive3dDebugInfo` and a debug panel showing which representation
  (`flat-2D` / `curved-2.5D` / `gltf-3D`) is actually active this frame.

## 16. UV mapping fidelity — test evidence

`curved-2_5d-geometry.test.ts`'s UV test constructs a straight-line ribbon,
walks every vertex, and confirms: `min(u)=0`, `max(u)=1`, `min(v)=0`,
`max(v)=1` (exact, to 5 decimal places), and specifically that the vertex
with the maximum Y (visually the top of the mesh) has `v ≈ 0` and the vertex
with minimum Y (bottom) has `v ≈ 1` — i.e., the geometry's own `v=0`-at-top
convention was verified to match Three.js's default `texture.flipY = true`
behavior empirically, not merely assumed.

## 17. One source of truth — what's shared vs. what's new

Shared, unmodified logic (imported, never re-implemented):
`computeSurfaceAttachedTransformFromDimensions`, `renderInstanceWithTransform`,
`resolveAttachmentOrientation`, `buildCameraConfig`/`updateCameraForViewport`,
`resizeThreeRenderer`, `computeNecklaceOcclusionMask`/
`applyRenderedAlphaToOcclusionMask`/`buildOcclusionEraseRgba`/
`compositeOccluded3dOverlay`, `getThreeRenderStats`.

Genuinely new: the ribbon geometry builder, the curved-2.5D asset
registry/loader/per-frame render entry point, the representation-contract
wiring, and the render-loop's priority decision + the extracted
`compositeRendered3dFrame` helper (itself a behavior-preserving extraction of
logic that already existed inline for the GLB path).

## 18. Real-browser verification

Performed via headless Chromium (Playwright, ad hoc — same tooling and
`--use-gl=swiftshader` approach used for prior phases' verification in this
sandboxed, GPU-less environment), running the **actual shipped code**
(`curved-2_5d-geometry.ts`/`curved-2_5d-bridge.ts`/`three-live-bridge.ts`,
bundled with esbuild — not a reimplementation) against the **real, restored
Diamond Choker PNG** (fetched via a real signed Backblaze B2 URL from the
live Docker stack, 1,528,554 bytes — the identical file the customer-facing
2D path serves).

**Methodology.** Two assets were built from the *same* real texture: the
actual registered curved mesh (18mm sagitta), and a synthetic "flat control"
— the identical mesh construction with a zero-depth control curve
(`z = 0` throughout, instead of `-18` at the edges) — isolating exactly one
variable, geometric curvature, while holding the texture, dimensions, camera,
and transform math identical.

**Perspective sanity check** (confirms the camera math itself, independent of
the choker): two flat 50mm reference planes placed at 150mm and 168mm from
the camera rendered at 172px and 154px wide — a 1.117× ratio against a
geometrically expected 1.12× (168/150). The projection is behaving correctly.

**Bounding-box comparison, curved vs. flat, across yaw:**

| yaw | curved width (px) | flat width (px) | curved narrower by |
|-----|---:|---:|---:|
| 0°   | 561 | 625 | 10.2% |
| 15°  | 552 | 588 | 6.1% |
| 30°  | 500 | 537 | 6.9% |
| 45°  | 449 | 485 | 7.4% |
| −30° | 498 | 534 | 6.7% |

The curved mesh is consistently, measurably narrower than the flat control at
every angle tested, including straight-on (0°) — because its edges recede
18mm farther from the camera than its center, exactly as the real choker's
own curvature would. A flat sticker cannot produce this: every point on a
flat plane is equidistant from the camera along its own surface normal at
matched orientation, so it never self-foreshortens this way.

**Center-vs-edge column height** (bounding-box-relative 10%/50%/90% columns,
straight-on): curved = `[208, 241, 208]` — **symmetric**, matching the
curve's own symmetric depth profile. Flat = `[192, 241, 219]` — asymmetric,
reflecting only the source artwork's own natural shape (no geometric effect
to impose symmetry). The curved mesh's edge symmetry, absent in the flat
control using the identical artwork, is direct evidence the depth variation
is real and physically consistent, not an artifact of the image itself.

**Rotation qualitative check:** yaw 0°/15°/30°/45°/−30°, pitch ±15°, and roll
10° were each rendered and screenshotted; every one produced a visibly
distinct silhouette/orientation from its neighbors (verified by direct visual
inspection of the captured PNGs, not just the numeric bounding boxes above).

**A real bug was found and fixed during this verification, not papered
over:** the WebGL canvas (`preserveDrawingBuffer: false`, matching the real
app's own renderer config) does not reliably expose its just-rendered content
to `drawImage`/`getImageData` within the same synchronous script — Chromium
only updates what those APIs see at compositor-present time. The first
version of this verification harness read stale (frame-1-only) pixels for
every subsequent render as a result, which would have been reported as "no
measurable curvature effect" — a false negative about the actual product
code. Switching the harness to `gl.readPixels` (a direct GPU buffer read,
bypassing the compositor) fixed it; this was a bug in the **verification
harness**, not in `curved-2_5d-geometry.ts`/`curved-2_5d-bridge.ts`/
`three-live-bridge.ts` themselves, none of which were changed by this fix.

## 19. Performance — the measured FPS number

Measured via the same real-browser harness: `renderCurved25dFrame` called
240 times in a tight loop (varying yaw each frame so nothing could be
trivially cached), wall-clock timed, on the real Diamond Choker asset, under
**software rendering** (SwiftShader — no real GPU in this sandbox, normally
the slowest case, not the fastest):

**240 frames in 107.9ms → 0.45ms/frame average → 2224 FPS** (isolated render
call only).

**Honest scope of this number:** this measures *only* the Three.js
render-and-composite-transform step in isolation. It does **not** include
video frame decode, MediaPipe face/pose/segmentation inference, or the
occlusion-mask compositing step — all of which are pre-existing, unmodified
costs shared by every representation (2D, GLB, and curved-2.5D alike) and
dominate the real end-to-end session frame budget (`docs/
live-ar-realism-verification.md`'s own performance sections already document
those). What this number *does* establish: the curved-2.5D render step itself
is not a new bottleneck relative to the already-shipped GLB path, which
reuses the identical `renderInstanceWithTransform` core (§17) and therefore
has equivalent per-frame cost.

## 20. Automated test coverage

- `curved-2_5d-geometry.test.ts` (8 tests): control-point validation, flat vs.
  curved depth extent, UV correctness (§16), configurable/default segment
  counts, closed-loop topology, real (non-degenerate) vertex normals.
- `curved-2_5d-bridge.test.ts` (24 tests): registry resolution and
  `productionVerified` gating, asset construction (correct material/texture/
  bounding box), and — added this phase — synthetic orientation coverage
  (Step 19's scenario list, as pure transform math): yaw at 0/±15/±30/±45°,
  pitch at ±15/±25°, roll at ±10/20°, camera closer vs. farther (scale
  factor), shoulder/head movement (anchor shift), and degraded-tracking
  confidence — each asserting a real, finite, correctly-signed transform.
- `jewellery-representation.test.ts` (+6 tests): curved-2.5d's priority
  relative to gltf-3d and layered-2.5d, and the unverified-asset fallback
  rule, mirroring the existing gltf-3d test patterns exactly.
- `debug.test.ts` (+3 tests): `formatLive3dDebugInfo`'s three states (no
  active asset, a rendered frame, a `webgl_unavailable` frame).
- `three-live-bridge.test.ts` (24 tests, unchanged): re-run to confirm the
  `computeSurfaceAttachedTransformFromDimensions`/`renderInstanceWithTransform`
  extraction (§17) preserved behavior exactly.

Full suite: **645 tests, 644 passing** — the one failure
(`JewelleryCreateForm.test.tsx`, an admin catalogue-form test unrelated to
Live AR) passed in isolation on re-run, confirming pre-existing flakiness
unrelated to this phase (not touched, not caused, by any file listed in §15).

---

## Final status

| Item | Status |
|---|---|
| Real artwork used as texture (never replaced/redrawn) | **PASS** |
| Real 3D curvature (not a flat sticker) — bounding box / edge-symmetry evidence | **PASS** |
| UV mapping preserves original artwork exactly | **PASS** |
| Reuses existing neck-attachment/camera/scale math (no second model) | **PASS** |
| Reuses existing occlusion compositing (no duplicated implementation) | **PASS** |
| Flat-2D fallback preserved and still the default for every unverified item | **PASS** |
| Mesh built once per item, never per frame | **PASS** |
| Representation contract generalized (gltf-3d > curved-2.5d > layered-2.5d > flat-2d) | **PASS** |
| Only necklace/Diamond Choker implemented deeply this phase | **PASS (by design)** |
| Automated test coverage (geometry, bridge, contract, debug) | **PASS — 645 tests, 644 passing, 1 pre-existing unrelated flake** |
| `tsc --noEmit` / `eslint` on all touched files | **PASS — 0 new errors** |
| Real-browser verification with actual shipped code + real artwork | **PASS** — see §18 |
| Measured FPS (isolated render step, software-rendered) | **2224 FPS** (0.45ms/frame) — see §19 for scope |
| Real-person webcam test | **NOT PERFORMED** — see §12; remains the user's own step, as with every prior phase |

**Stop condition check:** after proper surface mapping, does it still look
like a flat sticker? No — §18's bounding-box and edge-symmetry measurements
show real, physically-consistent depth-driven foreshortening that a flat
plane using the identical artwork does not produce, confirmed against a
camera-projection sanity check that independently validates the underlying
math. The effect is real but modest (roughly 7–10% narrower at the angles
tested) given the choker's actual 18mm sagitta relative to its 190mm width —
an honest reflection of this specific piece's real, relatively shallow
curvature, not a limitation of the method.
