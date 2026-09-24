# Diamond Choker — Prototype Measurements

**Status: PROTOTYPE / ESTIMATED — NOT PHYSICALLY MEASURED**

The real catalogue record for this item (`b68b76b3-55ba-4808-869c-4d8266f7aff7`,
`diamond-choker`, SKU `NCK-003`) has `physical_width_mm` / `physical_height_mm` /
`physical_depth_mm` / `weight_g` all unset — confirmed by a direct, read-only database
query (see `docs/live-ar-3d-representation-assessment.md`'s Phase A findings). Every
number below is an **engineering estimate for a first 3D pipeline-testing prototype**,
derived from the existing reference PNG's measured pixel proportions plus a chosen
scale anchor — never claimed as a real physical measurement, and never written into
the production `Jewellery` row (see §6, "Do not modify the database").

## 1. Measurement table

| Measurement | Value | Source | Confidence |
|---|---:|---|---|
| Width | 190 mm | **chosen scale anchor** (see §2) | prototype |
| Height | 106 mm | derived from reference image (measured ratio × chosen width) | prototype |
| Depth | 12 mm | engineering estimate (not derivable from a single 2D photo) | prototype |
| Band thickness (solid cluster, excl. drops) | 80 mm | derived from reference image (row-fill-fraction analysis, see §2) | prototype |
| Central pendant width | 34 mm | proportional estimate (visual inspection of a cropped region) | prototype (lower) |
| Central pendant height | 38 mm | proportional estimate (visual inspection of a cropped region) | prototype (lower) |
| Drop length | 26 mm | derived (Height − Band thickness, cross-checked against the visible fringe) | prototype |
| Horizontal wrap sagitta (front-to-back pull-back at the ends) | 18 mm | engineering estimate — see §2's curvature note | prototype (lower) |

## 2. Derivation method

**Image dimensions used**: the existing "processed" asset, 1254×775px, alpha bbox
`[33, 53, 1232, 722]` → effective **1199×669px**, height/width ratio **0.558**,
left/right symmetry **92.8%** (all measured directly from the real downloaded PNG, not
estimated — see the Phase A audit for the exact script/method).

**Width (190mm) — the chosen anchor.** Nothing in the image gives an absolute scale
(a photo alone has no metric reference object in frame), so ONE dimension had to be
chosen as an anchor and everything else derived from it. 190mm was chosen as a
plausible corner-to-corner span for a wide "bib"-style diamond choker on an adult neck
— real bib/statement chokers of comparable visual density commonly run in the
150-220mm range; 190mm sits in the middle of that range rather than at either extreme.

**Height (106mm) — derived, not chosen.** `190mm × 0.558 (measured ratio) = 106.0mm`.
This is the one dimension that follows mechanically from a real measurement once the
width anchor is picked — the ratio itself came from the actual alpha bbox, not a guess.

**Band thickness (80mm) vs. drop length (26mm) — derived from a real row-by-row
measurement.** The reference image's alpha channel was scanned row by row, computing
what fraction of columns are non-transparent at each row ("fill fraction"). This
produced a real, measured profile: fill rises from ~5% at the very top (only the two
raised clasp-corners are that high) to a solid >85% core spanning roughly 27%-57% of
the bbox height (the main gold/diamond cluster), then declines and becomes
increasingly irregular from ~75% of the height downward (individual pear-shaped drops
separated by transparent gaps — a real, measured signature of "these are discrete
hanging elements, not a solid band"). The band/drop boundary was read off this profile
at the point fill drops sustained below ~0.5 (~75% of bbox height): **80mm** = 75% of
106mm (band + its curved rise into view), **26mm** = the remaining 25% (drop fringe).

**Central pendant (34×38mm) — a lower-confidence VISUAL estimate**, not a pixel
algorithm result. The alpha channel alone can't isolate "the central pendant" from
the surrounding cluster (it's all one connected non-transparent mass) — a cropped
close-up of the center was inspected visually (a square-cut diamond inside a
floral/marquise-petal gold medallion), and its extent was estimated as a fraction of
the already-measured overall width/height, then converted using the derived
scale (≈6.31 px/mm at the chosen 190mm width). Flagged as lower confidence than the
width/height/band/drop numbers above, which all trace back to a real pixel
measurement.

**Depth (12mm) — a pure engineering estimate, not derived from the image at all.** A
single 2D photograph carries no depth information (this is the exact limitation
`docs/live-ar-3d-representation-assessment.md` established for why 2D deformation
can't fake 3D realism — it applies equally to reconstructing a depth measurement from
one photo). 12mm reflects a generic assumption for how a densely prong/bezel-set
stone cluster of this apparent density typically sits: stones commonly raised
3-8mm above a 3-5mm backing/setting structure, combining to roughly 10-15mm total.
This is the single least-grounded number in this document.

**Horizontal wrap sagitta (18mm) — a pure engineering estimate, with an important
caveat.** An attempt was made to derive this from circular-arc geometry (treating the
190mm width as a chord across a typical adult neck cylinder, assumed radius
≈55.7mm from a ≈350mm neck circumference) — this arithmetic is IMPOSSIBLE (a 190mm
chord cannot fit any circle with radius 55.7mm; the maximum possible chord is the
diameter, 111.4mm). This reveals that a wide bib-style choker like this one does not
tightly hug the neck as a deep circular wrap — it sits more like a flattened collar
across the front, with only a gentle curve pulling the ends back. 18mm (the
front-to-back depth difference between the center-front point and the end clasps) is
a modest, plausible gentle-curve estimate given that finding, not a value derived from
strict arc geometry. See §5, limitations.

## 3. Geometry proportions (from the reference image)

- **Overall shape**: a wide, bib-style choker — not a thin band. The upper contour
  dips at the center and rises toward two raised end-clasps (visible directly in the
  reference photo; the 3D prototype's vertical silhouette should trace this same
  contour, not a flat rectangle).
- **Band structure**: a dense, continuous cluster of round/marquise/pear-cut stones
  set in gold, occupying the "band thickness" region (§1/§2) — this is NOT a plain
  metal strip; the prototype geometry needs visible surface texture/density here even
  at low polygon counts (see §4).
- **Central pendant**: a square-cut diamond inside a raised floral medallion of
  marquise-petal stones, at the horizontal center, positioned within the band
  structure (not separately hanging).
- **Drop fringe**: a graduated row of pear-shaped drops hanging from the band's
  bottom edge, longer toward the center, shorter toward the sides (visible directly in
  the reference photo).
- **Left/right symmetry**: 92.8% (measured) — the 3D prototype should be built as a
  genuinely symmetric mesh (mirror one half), consistent with this real measurement.
- **Attachment region**: see §4/§5 — the reference image's own default 2D anchor
  convention (bbox top-center) lands on a fully TRANSPARENT pixel for this asset
  (confirmed: the center column's topmost opaque pixel is 23.5% down the bbox, not at
  the top) — the prototype should NOT reuse that literal convention; see §4 for the
  corrected attachment point.

## 4. Geometry specification for GLB generation

This section is what the next asset-generation step should build against. The
**M6.8 `Gltf3dAssetMetadata` contract remains the governing spec** for how this
connects to the render pipeline — see `docs/jewellery-3d-asset-spec.md` for the
general requirements (real thickness/curvature baked into the mesh, PBR
metallic-roughness, ≤~20k triangles, no baked lights/camera/animation, etc.); this
section only adds THIS specific item's target numbers.

| Property | Target |
|---|---|
| Overall dimensions (W × H × D) | 190mm × 106mm × 12mm |
| Target aspect ratio (H/W) | 0.558 — validated in §7 |
| Band structure height | 80mm |
| Drop fringe length | 26mm (graduated: shorter at the sides, longest ≈26mm at center) |
| Central pendant | 34mm × 38mm, centered horizontally, embedded within the band (not separately hanging) |
| Horizontal wrap sagitta | 18mm gentle pull-back at the ends relative to center-front (NOT a tight circular wrap — see §2/§5) |
| Origin / attachment point | Local `(0, 0, 0)`, placed at the horizontal center of the band, at the height where the band's real cluster begins (not the bbox's literal top — see §3) |
| Coordinate orientation | `+Y` up, `+Z` = the choker's own visible front (the side shown in the reference photo) facing the camera at yaw=0, `+X` = the photo's own screen-right — matches `apps/web/src/lib/live-ar/three/three-types.ts`'s existing world-space convention exactly, so no extra conversion is needed when the mesh is placed |
| Geometry separation | At minimum: band/cluster structure, central pendant medallion, drop fringe as distinguishable groups (helps future per-region material/animation work; not required to be separate glTF nodes if that adds unjustified complexity for a first prototype) |
| Recommended triangle budget | Well under the asset spec's ~20,000-triangle ceiling — a prototype validating the RENDER PIPELINE (not manufacturing fidelity) should target low thousands, favoring correct silhouette/curvature/thickness over fine stone-facet detail |
| Recommended material setup | glTF PBR metallic-roughness: gold band (`metallic≈1`, moderate roughness — see `three-materials.ts`'s `createFallbackGoldMaterial` for this pipeline's own reasonable starting values) + a separate stone material (low metalness, low roughness, higher transmission/clearcoat if the toolchain supports it — otherwise a bright, low-roughness dielectric is an acceptable prototype stand-in) |

## 5. Assumptions, limitations, and attachment-point notes

- **Every mm value in this document is an estimate for pipeline-testing purposes.**
  None should be read as, or copied into, real physical/catalogue data.
- The **width anchor (190mm) is a judgment call**, not a measurement — every other
  derived-from-image number is only as good as this choice.
- **Depth (12mm)** and the **horizontal wrap sagitta (18mm)** are the two least-grounded
  numbers here: a single 2D photo cannot supply either, by construction (the same
  fundamental limitation established in `docs/live-ar-3d-representation-assessment.md`).
- The **circular-arc wrap-radius approach was tried and found geometrically
  inconsistent** for this item at this width (§2) — worth re-examining if a real
  physical measurement later shows the actual piece IS narrower/more tightly curved
  than this 190mm estimate assumes.
- The **central pendant dimensions are a visual estimate**, not a pixel-algorithm
  result — treat as the lowest-confidence numbers in the table.
- **Attachment point**: the reference asset's own DEFAULT 2D anchor (used by the
  existing 2D Live AR pipeline whenever no admin override is set, which is the case
  for this item — `anchor_x`/`anchor_y` are both `None` in the real database record)
  is the bounding box's top-center pixel. For THIS asset, that pixel is
  **fully transparent** — the real geometry doesn't start until 23.5% down the bbox at
  that column. This prototype's chosen 3D attachment point (§4) corrects for that by
  using the height where real content actually begins, not the bbox's literal top.
  This is a real, measured observation, not a hypothetical edge case.
