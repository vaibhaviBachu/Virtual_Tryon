# Live AR Jewellery Representation Assessment (M6.7)

Written against the "M6.7 — JEWELLERY REPRESENTATION UPGRADE / 3D-READY LIVE AR"
request. Steps 0-3 are a technical audit (this document's main content); Step 4 is
implemented in code (`jewellery-representation.ts`); Steps 5-10 are documented
architecture decisions, not yet implemented, for the reasons explained in each
section and summarized at the end.

## Step 0/1 — Can a flat PNG ever produce "actually wearing it" under rotation?

**No — not fundamentally, regardless of how sophisticated the 2D math gets.** This is
not a guess; it follows from what a flat PNG asset physically *is*.

A catalogue asset (confirmed by direct inspection of `db/models/jewellery_asset.py`
and `ai/catalogue/processor.py`) is a single RGBA raster image: one fixed photograph
of the jewellery from one fixed camera angle, background-removed and alpha-cropped.
It contains exactly the pixels visible from that one angle. It does not contain, and
cannot be made to contain by any 2D transform, pixels for:

- the jewellery's side or back (a front-facing product photo never captured them),
- its physical thickness (a photo has no depth axis),
- how its metal surface/facets would look lit from a different angle (the highlights
  baked into the photo are fixed to that one lighting/viewing setup).

M6.5/M6.6's strip-warp + elliptical projection (`jewellery-deformation.ts`,
`neck-projection.ts`) can only **rearrange pixels that already exist** — shift them
vertically (curvature bow) or compress the whole sprite horizontally (foreshorten).
Neither operation, nor any more elaborate 2D warp, can synthesize a side view that was
never photographed. This is the precise, load-bearing distinction between "2D
deformation" and "3D representation": deformation moves existing pixels; only a real
3D asset (or a multi-view captured asset) has NEW pixel data to reveal at a new angle.

### Precise behavior at each Step 1 test angle (traced from the current M6.6 code, not measured on a real device — see the M6.6 report's own real-device gap)

| Angle | What M6.6 actually does | What it can't do |
|---|---|---|
| 0° (straight) | `yawAsymmetry=0` → exact M6.5 parabola, `horizontalForeshorten=1`. Matches the source photo's own angle — this is the ONE angle a flat PNG is genuinely correct at. | — |
| 15° L/R | Small `estimateHeadYawAsymmetry` reading → small contact-peak shift + `cos`-based foreshorten (bounded, floor 0.6). A real, measured, non-fabricated response — but a whole-sprite scale change, not a new view. | Cannot reveal the side of the necklace now technically facing more toward camera; cannot change which facets catch light. |
| 30° L/R | Larger reading → larger shift/foreshorten (still floored at 0.6× width, `NECKLACE_MIN_HORIZONTAL_FORESHORTEN`). | Same as 15°, more visible: a real necklace viewed at 30° would show meaningfully different geometry (chain overlap, clasp position) that the source photo never captured — the flat asset still shows the SAME front-on content, just narrower. |
| Closer/farther | Unaffected by M6.5/M6.6 — `computeScale`'s existing shoulder-width/physical-mm calibration already handles this correctly (pre-existing capability, not part of this gap). | — |

Answering Step 1's checklist directly: a flat PNG (with or without 2D deformation)
**cannot** represent changing visible circumference, left/right depth, front/back
portions, thickness, or metal-surface-orientation-under-angle. It **can** (via M6.5/
M6.6) provide a bounded, honest approximation of changing perspective and a crude
depth proxy (distance-from-contact-point) — cosmetic cues, not the underlying
geometry.

## Step 2 — Option comparison

| | A: Flat PNG + 2.5D (current) | B: Layered 2.5D (multi-view/depth-map) | C: Real 3D (glTF/GLB) |
|---|---|---|---|
| Realism | Low-medium; correct only at the captured angle | Medium; genuinely new pixels at a few discrete angles if multiple views are captured | Highest; continuous rotation, true depth/thickness |
| Browser performance | Excellent — already measured negligible (`deformationMs`, M6.6 report) | Good — still Canvas 2D compositing/blending | Real WebGL render cost per frame; manageable for ONE small object but non-zero, and new (texture/shader load, GC of GPU resources) |
| Implementation complexity | Done (M6.5/M6.6) | Medium — needs a view-selection/blend mechanism keyed off yaw | High — new render pipeline, coordinate system, Canvas-2D/WebGL compositing interop |
| Catalogue requirements | None beyond today's single PNG | New asset relationship (multiple views, or a depth-map asset type) | New asset type + storage + admin upload flow |
| Asset creation requirements | Cheapest — existing single-photo pipeline | Moderate — several photos per item, or manual depth-map authoring | Highest — 3D scanning or commissioned modeling; a different production pipeline entirely, not achievable from this codebase |
| Head rotation | Cosmetic only (this doc's Step 1 table) | Real but discrete (only as many angles as captured) | Continuous, geometrically correct |
| Scaling | Already correct (unaffected) | Already correct (unaffected) | Needs a new 3D-scale calibration (Step 7) |
| Depth | 2D proxy only | Per-view baked depth cue at best | Real, from the mesh |
| Occlusion | Already works (M6.4, orthogonal to representation) | Same, orthogonal | Same, orthogonal — see Step 8 below |
| Lighting | None (fixed in the source photo) | Fixed per captured view | Real PBR possible (Step 9), but explicitly deferred until geometry/attachment/perspective/depth are proven first |
| Long-term maintainability | Simple, but has a realism ceiling this doc just established | More asset variants per item to manage/version | Heaviest new subsystem, but the only path with real long-term ceiling for "wearing" realism |

**No option is chosen "for convenience"** — the product requirement (Step 1's
finding) genuinely needs new visual information under rotation that Option A cannot
ever provide. Option C is the only one that removes the ceiling; Option B is a real,
cheaper middle ground if full 3D asset production isn't feasible near-term.

## Step 3 — Does every category need the same representation?

No — and today's Live AR pipeline doesn't even attempt most of these categories yet.
Checked directly against the code (`CategorySlug` in `types.ts`, `computeAnchor`/
`computeScale`/`computeRotation` in `geometry.ts`): **only `"earrings"` and
`"necklace"` (with `"haaram"` folded in as a necklace-mode sub-category) have any
placement logic at all.** Ring, bangle, bracelet, maang tikka, and nose ring are not
implemented in Live AR today, in 2D OR 3D — this is a real, honest gap, not a
prioritization note. `JewelleryCategory.slug` is a free-text admin-created column
(no fixed enum), so an admin COULD create those categories and upload PNGs for them,
but no anchor/scale/rotation math exists in this codebase to place them on a live
camera feed.

For the categories that DO exist:
- **Choker/medium necklace**: benefits most from 3D — sits directly on/around a highly
  curved, frequently-rotating body part (the neck), exactly where Step 1's flat-PNG
  ceiling is most visible.
- **Haaram**: the neck-contact region is small relative to the piece's total length;
  most of a haaram's visible content (the long hanging portion) is roughly planar and
  gravity-draped, so it needs LESS from 3D than a choker does — 2.5D/Option B may be
  sufficient for the hanging portion, with only the neck-contact region needing better
  geometry.
- **Earrings**: small, mostly-frontal, less rotation-sensitive than a full necklace at
  typical camera distances — a reasonable 2.5D/Option B candidate before 3D.
- Ring/bangle/bracelet/maang tikka/nose ring: **out of scope entirely** — no Live AR
  placement logic exists for them regardless of representation, per the finding above.

**Conclusion: do not force one representation architecture onto every category** —
exactly what Step 4's contract (below) is designed to allow.

## Step 4 — The representation contract (implemented)

`apps/web/src/lib/live-ar/jewellery-representation.ts`:

```ts
export type JewelleryRepresentationType = "flat-2d" | "layered-2.5d" | "gltf-3d";

export function resolveJewelleryRepresentation(input: JewelleryRepresentationInput): JewelleryRepresentation
```

Resolution order: `gltf-3d` > `layered-2.5d` > `flat-2d` (spec Step 10's fallback
requirement — richer representations win when present, the existing PNG renderer is
always the floor). **Always resolves to `"flat-2d"` today** — the input fields for
the other two representations exist in the type but are never populated, because no
catalogue schema field exists yet for either (confirmed, not assumed — see Step 11
below). 8 unit tests (`jewellery-representation.test.ts`) cover PNG fallback, 3D
selection, layered selection, precedence when multiple are present, that the flat
asset is always carried through as a fallback regardless of which type is selected,
and a null-flat-asset edge case.

**Deliberately not wired into the render loop.** Every branch besides `flat-2d` would
be dead code with nothing real to call (Step 4's own "do not over-engineer"). This is
the seam a future milestone plugs a real renderer into once a real asset exists — see
"What blocks Step 11" below.

## Steps 5-9 — Designed, not implemented (blocked on Step 11)

Documented now so a future milestone with a real 3D asset in hand can implement
directly, without re-deriving the design:

- **Step 5 (library)**: **Three.js**, not Babylon.js or native WebGL, if/when 3D is
  built. Reasoning: this use case is "load one small GLB, composite it into an
  existing 2D canvas pipeline" — not a full 3D application. Three.js is the lighter
  dependency with the most examples for exactly this AR-compositing pattern (render to
  an offscreen WebGL canvas via `renderer.domElement`, then `ctx.drawImage()` that
  canvas onto the existing main Canvas 2D canvas, in the SAME place `drawJewelleryOverlay`
  draws today). Babylon.js is more full-featured but heavier for a single small mesh;
  native WebGL would mean hand-writing shader/matrix code Three.js already provides
  correctly. **Not installed** — no asset to render yet (installing an unused
  dependency is exactly the "add a large framework blindly" Step 5 warns against).
- **Step 6 (coordinate system)**: BODY SPACE (existing `BodyReferenceFrame`/
  `NeckReferenceFrame` — shoulder midpoint, neck attachment point, real per-frame
  measurements, already resolution-independent) → JEWELLERY SPACE (a local origin at
  the mesh's own designed attachment point, mirroring how `JewelleryAssetGeometry.
  anchorPx` works for 2D today) → camera projection. Pipeline order matches the
  request's diagram exactly: tracking → body reference → jewellery attachment →
  local transform → projection → render. No arbitrary screen coordinates — every stage
  reuses a REAL measured quantity, same discipline as the entire pipeline today.
- **Step 7 (necklace attachment)**: a 3D attachment config would need the SAME real
  quantities `neck-projection.ts`/`neck-surface.ts` already compute (neck width →
  radius, contact peak, yaw asymmetry) reused as the 3D mesh's orbit/attachment
  parameters — not shoulder-width-only scaling, matching the request's explicit "do
  not simply scale the entire mesh based on shoulder width."
- **Step 8 (depth/occlusion)**: **M6.4's occlusion is preserved unchanged.** The
  established interop pattern: render the 3D mesh to an offscreen WebGL canvas, then
  feed that canvas into the EXISTING `drawOccludedJewelleryOverlay`/`destination-out`
  pipeline exactly like the current `HTMLImageElement` sprite is — Canvas 2D's
  `drawImage` accepts a WebGL canvas as a source natively, so hair/clothing occlusion
  needs no new code, only a new image SOURCE.
- **Step 9 (material)**: a real glTF PBR material (metalness/roughness) if/when a
  real asset exists — explicitly NOT a colour-filter fake gold (matches the request's
  own instruction), and explicitly deferred until geometry/attachment/perspective/
  depth are proven on a real asset first.

## Step 10 — Migration strategy (already satisfied by the Step 4 contract)

`resolveJewelleryRepresentation`'s fallback order IS the migration strategy: an item
with no 3D/layered asset (every item today) renders exactly as it does now; an item
that gains a 3D asset in the future would automatically resolve to `"gltf-3d"` the
moment that field is populated, with zero changes to any OTHER item's rendering path.
Existing PNG assets are never touched, deleted, or required to change.

## Step 11 — STOP: no 3D asset exists in this repository

Checked directly, not assumed: `find . -iname "*.glb" -o -iname "*.gltf"` across the
entire repository returns nothing (excluding unrelated compiled `.obj` binaries from a
Python package dependency, which are not 3D meshes). `package.json` has no Three.js/
Babylon.js/WebGL-related dependency. The catalogue schema
(`db/models/jewellery_asset.py`) has no column for a 3D asset reference at all.

**Per the explicit instruction — "If a suitable 3D jewellery asset does not exist in
the repository, STOP and report that an actual 3D asset is required. Do NOT fabricate
a fake 3D mesh from arbitrary assumptions" — this milestone stops here.** Steps 12-14
(real-device test of the POC, before/after comparison, 3D performance measurement)
have no proof-of-concept to test and are not performed. Producing one requires either
a 3D-scanned or commissioned model of a real catalogue piece (e.g. the "Diamond
Choker" seen in the product screenshots) — outside what can be produced from inside
this codebase.
