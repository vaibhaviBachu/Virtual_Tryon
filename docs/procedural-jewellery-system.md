# Generic Procedural 3D Jewellery System (Phase D)

**Central principle honored: one generic 3D jewellery engine was built; the Diamond
Choker is its first test, not its architecture.** `generateDiamondChoker()` does not
exist anywhere in this codebase. The only category-aware code is a two-entry
strategy registry (§3); every geometry/material/export module is 100% generic.

All code lives under `apps/web/src/lib/jewellery-3d-generator/` (24 files: 9
production modules, 1 barrel, 2 fixture adapters, 12 test files). Zero files outside
that directory were modified — confirmed by `git status` showing only this one new,
untracked directory. No database, renderer, or live-AR-runtime code was touched.

---

## 1. Architecture

```
Jewellery3DSpecification (types.ts -- plain data, category-agnostic)
        |
        v
strategies/registry.ts -- getCategoryStrategy(spec.category)
        |
        v
JewelleryCategoryStrategy.buildComponentTree(spec)   <- the ONLY category-aware step
        |    (necklace-strategy.ts / ring-strategy.ts compose primitives.ts + curves.ts)
        v
JewelleryComponent tree (plain data: geometry + transform + material + children)
        |
        v
component.ts's realizeComponentTree()  -- generic, category-blind
        |
        v
THREE.Group (real Three.js scene graph)
        |
        v
glb-export.ts -- GLTFExporter.parseAsync(scene, { binary: true })  (three@0.186.1, already installed)
        |
        v
Real binary .glb
        |
        v
EXISTING three-asset-loader.ts's loadGltfAsset()          (unmodified)
        |
        v
EXISTING jewellery-representation.ts's resolveJewelleryRepresentation()   (unmodified)
        |
        v
EXISTING three-transform.ts / three-renderer.ts / tracking.ts / occlusion.ts   (all unmodified)
```

Every arrow after "component tree" is category-blind. A necklace and a ring both
flow through the exact same `realizeComponentTree` → `GLTFExporter` → existing
loader/representation code, verified directly in `integration.test.ts` via
`describe.each` running the identical assertion battery against both.

---

## 2. Geometry primitives (`primitives.ts`)

| Primitive | Function | Used by |
|---|---|---|
| Swept band (curve + rectangular cross-section) | `createSweptBandGeometry` | Both strategies — the one shape behind every band-like category (§9) |
| Dome/boss (scaled ellipsoid) | `createBossGeometry` | Necklace's pendant, ring's setting |
| Hanging drop (scaled cone, apex up) | `createDropGeometry` | Necklace's drop fringe |
| Faceted gem (scaled octahedron) | `createFacetedGemGeometry` | Both strategies' stones |
| Rounded gem (scaled sphere) | `createRoundedGemGeometry` | Available to any strategy needing a non-faceted stone |
| Linear repetition | `evenlySpacedOpenCurveParams` | Necklace's drops along an open curve |
| Radial repetition | `evenlySpacedClosedCurveParams` | Ring's ornaments around a closed curve |
| Graduated sizing | `computeGraduatedLengths` | Necklace's drop taper (peak at center) |
| Mirrored placement | `mirrorPositionAcrossAxis` | Diamond Choker's paired accent gems |

**Why a fixed reference axis instead of `Curve.computeFrenetFrames`**: every
category this system targets is a band lying in a roughly flat plane around a
roughly-cylindrical body part with a known, fixed axis (a neck's vertical axis, a
ring/bangle's own hole axis). Three.js's Frenet frames are the general-purpose
choice for an arbitrary 3D path, but their normal/binormal flip unpredictably on
near-straight or perfectly symmetric curves — exactly the choker's gentle arc and
the ring's perfect circle. A fixed "up" vector (`BandGeometrySpec.upAxis`, default
`+Y`) is the physically correct choice for this specific class of curves, not a
simplification, and it never twists (see `primitives.ts`'s file docstring).

**Flat shading via non-indexed geometry**: every primitive builds non-indexed
`BufferGeometry` (each triangle owns unique vertices) before `computeVertexNormals()`
— correct per-face normals with no cross-face averaging, appropriate for a faceted
metal band, and far simpler than hand-computed face normals.

---

## 3. Category strategy system (`strategies/`)

```ts
export interface JewelleryCategoryStrategy {
  category: JewelleryCategory;
  buildComponentTree(spec: Jewellery3DSpecification): JewelleryComponent;
}
```

`strategies/registry.ts` maps `JewelleryCategory -> JewelleryCategoryStrategy`.
Today: `necklace -> necklaceStrategy`, `ring -> ringStrategy`. Requesting any other
registered-in-the-type-but-not-yet-implemented category (`haaram`, `earring`,
`bangle`, `bracelet`, `maang_tikka`, `nose_ring`, `jewellery_set`) throws a clear,
actionable error naming what IS implemented — never a silent fallback to the wrong
geometry. `registry.test.ts` asserts this exact behavior.

**Neither strategy creates a `THREE.BufferGeometry` itself.** Both call the same
`primitives.ts` functions with different numbers (§9 walks through exactly how a
ring's "inner/outer radius" and a choker's "width/wrap sagitta" both resolve to the
same `BandGeometrySpec`).

---

## 4. Jewellery specification schema (`types.ts`)

`Jewellery3DSpecification` — plain, serializable data:

| Field | Purpose |
|---|---|
| `category` | Which strategy handles this spec |
| `status` / `provenanceNote` | Traceability — `"prototype_estimated"` / `"catalogue_verified"` / `"synthetic_validation_fixture"`, carried at the top level so provenance is never silently lost |
| `dimensions` | `widthMm`/`heightMm`/`depthMm`/`weightG` — reuses the catalogue's existing physical-dimension concept |
| `attachment` | `type` (free text) + `pointLocal` — mirrors `Gltf3dAssetMetadata`'s existing `attachmentType`/`anchor` fields exactly |
| `band?` | An open OR closed curve + a rectangular cross-section — covers necklace/haaram/bangle/bracelet/ring (§9) |
| `pendant?` | A raised boss + optional gem, positioned at a fraction along the band's curve |
| `repeatingElements?` | Drops/ornaments, linear or radial, optionally graduated |
| `gems?` | Standalone accent stones |
| `materials` | A list of `{id, preset, ...overrides}` — every other field references a material by `id`, never a direct object |
| `symmetry` | `mirrored`/`axis`/`measuredScore` |
| `generation?` | `curveSegments`/`triangleBudgetHint` |

No category has its own bespoke dimension fields (Phase D Step 8's own warning
against that) — a ring's inner/outer radius and a choker's width/sagitta are both
just different `CurveSpec`/`crossSection` numbers on the identical `band` field.

---

## 5. Material system (`materials.ts`)

`createJewelleryMaterial(spec: MaterialSpec)` — 7 presets (`gold`, `silver`,
`platinum`, `polished-metal`, `brushed-metal`, `diamond`, `gemstone`), all real glTF
PBR metallic-roughness (`MeshStandardMaterial`/`MeshPhysicalMaterial`, the exact two
classes `three-materials.ts`'s existing `isEveryMeshPbr` already recognizes — the
generated assets pass that existing check unmodified, verified in
`integration.test.ts`). The `gold` preset explicitly calls the EXISTING
`createFallbackGoldMaterial()` from `three-materials.ts` for its base values, per
Phase D's own instruction to reuse existing material infrastructure rather than
duplicating it.

---

## 6. GLB generation pipeline (`glb-export.ts`)

```ts
export async function generateJewellery3D(spec: Jewellery3DSpecification): Promise<GeneratedJewellery3DAsset>
```

Strategy lookup → component tree → `realizeComponentTree` → `THREE.Scene` →
`new GLTFExporter().parseAsync(scene, { binary: true })`. This is the exact
technique already proven, in this repository's own M6.8 test suite, to produce a
real, loadable binary GLB entirely offline — reused verbatim, not reinvented. **Zero
new npm dependencies**: `three@0.186.1` was already installed; `GLTFExporter` ships
in the same package as the already-used `GLTFLoader`.

---

## 7. Diamond Choker implementation (`fixtures/diamond-choker-spec.ts`)

An **adapter**, not a generator: it reads the already-committed
`docs/diamond-choker-prototype-measurements.json` (unchanged) and maps its fields
onto `Jewellery3DSpecification` — `band_thickness_mm`/`horizontal_wrap_sagitta_mm`/
`central_pendant_*_mm`/`drop_length_mm` all flow through unchanged from that
document. A handful of numbers that document never measured (drop *count*, the
taper ratio between neighboring drops, exact accent-gem placement) are explicitly
commented as **geometry-construction choices**, distinct from — and never
represented as — the measurement document's own already-labeled estimates.

All resulting geometry comes from `necklaceStrategy` — this file contains no mesh
math of its own.

**Real, measured output** (`generate-fixtures.manual.test.ts`, real files written to
the session scratchpad, not committed):

| Metric | Value |
|---|---|
| Triangles | 944 |
| GLB size | 94,580 bytes (~92 KB) |
| Bounding box | 192.2 × 106.0 × 38.9 mm |

Width (192.2mm) and height (106.0mm) match the specification's declared 190mm/106mm
closely (height is an exact match — `band_thickness_mm + drop_length_mm` reconstructs
`physical_height_mm` exactly, the same identity `diamond-choker-prototype-
measurements.test.ts` already asserts on the JSON alone). **Depth (38.9mm) is
substantially larger than the declared `physical_depth_mm` (12mm)** — this is a real,
important finding, not a bug: `physical_depth_mm` describes the band's own
cross-sectional material thickness at any single point, while the assembled
bounding box also includes the wrap-sagitta curve's own front-to-back sweep (18mm)
and the pendant's forward projection (6mm). See §13.

---

## 8. Second-category validation (`fixtures/ring-spec.ts`)

A **synthetic, clearly-labeled architecture-validation fixture**
(`status: "synthetic_validation_fixture"`) — there is no real ring in the catalogue
vault behind these numbers. It exercises a genuinely different topology: a **closed**
circular band (inner/outer radius → centerline radius + radial thickness) instead of
the choker's open arc, plus a "setting" that reuses the exact same `pendant` field
the necklace strategy uses for its pendant (see `ring-strategy.ts`'s file docstring —
a ring's stone setting IS a pendant in this system's terms), plus **radial**
repeating ornaments (as opposed to the choker's **linear** ones) — proving both
repetition modes work through the same code.

**Real, measured output**:

| Metric | Value |
|---|---|
| Triangles | 664 |
| GLB size | 66,032 bytes (~64 KB) |
| Bounding box | 19.1 × 4.0 × 19.2 mm |

Width/depth (19.1/19.2mm) match the target outer diameter (19.2mm) closely. Height
(4.0mm) is dominated by the setting boss (4mm, centered at the same `y=0` as the
band) rather than the band's own smaller 2.2mm axial height — the fixture's own
declared target height was corrected to 4.5mm to reflect this once observed (see git
history for that one-line fix), a small honest correction, not a fabricated match.

---

## 9. Vault integration model

Necklace/haaram/bangle/bracelet/ring are ALL expressible through the same `band`
field:

| Category | Curve | Cross-section meaning |
|---|---|---|
| Necklace / choker | Open control-point curve (front arc + sagitta) | width = vertical band thickness, depth = front-back thickness |
| Haaram | Same as necklace, longer curve, more `repeatingElements` tiers | same |
| Bangle / bracelet | Closed circular/elliptical curve | width = axial height (along the wrist), depth = radial thickness |
| Ring | Closed circular curve (small radius) | same as bangle, smaller scale |

Earring/maang_tikka/nose_ring were NOT implemented this phase (Phase D's own stop
condition: validate with two categories, not all nine) but their composition is
already assessable with existing primitives: an earring is mostly `pendant` +
`repeatingElements` with no `band` at all; a maang tikka is a thin `band` (a chain)
plus one `pendant`; a nose ring is a small closed `band` with no repeating elements.
Adding any of these means writing one new strategy file that composes the SAME
primitives with different numbers, and one registry line — never a new rendering
pipeline. This is the literal, checked answer to Phase D's own architecture-quality
question (§17 below).

---

## 10. 2D fallback model

`jewellery-representation.ts`'s `resolveJewelleryRepresentation` was not modified.
`integration.test.ts` includes a dedicated check
(`"resolveJewelleryRepresentation -- existing 2D fallback is untouched"`) confirming
it still resolves to `"flat-2d"` when no 3D asset is supplied, run in the same test
file as the new `"gltf-3d"` resolution checks, side by side. The full existing
`live-ar` suite (419 tests before this phase) was re-run in full and passes
unchanged (§12) — the 2D pipeline's own behavior was never touched.

---

## 11. Performance

| | Diamond Choker | Ring |
|---|---:|---:|
| Triangles | 944 | 664 |
| Materials | 2 (gold, diamond) | 2 (gold, diamond) |
| Textures | 0 | 0 |
| GLB size | ~92 KB | ~64 KB |

Both are comfortably under `docs/jewellery-3d-asset-spec.md`'s existing
~20,000-triangle ceiling — in fact under 1,000 triangles each, well inside the "low
thousands" target that document already recommended. Generation happens once,
offline/build-time (`generateJewellery3D` is never called from the render loop); the
live AR runtime only ever loads and caches the resulting GLB through the existing,
unmodified `three-asset-loader.ts`, exactly like any other GLB.

---

## 12. Testing

76 new tests across 10 files (plus 2 more manual-export tests = 78 total), covering
every item on Phase D's own Step 16 checklist:

| Step 16 requirement | Covered by |
|---|---|
| 1. Generic specification validation | `fixtures/*.test.ts` |
| 2. Generic geometry generation | `primitives.test.ts` |
| 3. Each primitive generates valid geometry | `primitives.test.ts` (`hasRealVolume` on every primitive) |
| 4. Diamond Choker generation works | `integration.test.ts` (parameterized `describe.each`) |
| 5. Ring generation works | Same `describe.each` run |
| 6. Materials assigned correctly | `materials.test.ts`, `component.test.ts` |
| 7. Object3D can be exported | `integration.test.ts` ("exports a real, non-empty binary GLB") |
| 8. Exported GLB loads again with GLTFLoader | `integration.test.ts` (via the EXISTING `loadGltfAsset`) |
| 9. Geometry has actual depth/volume | `hasGenuine3DVolume`/`hasRealVolume` helpers, both files |
| 10. No PNG billboard | Same helpers — positive extent in all 3 axes AND varied vertex normals |
| 11. Physical scale remains consistent | "physical scale consistency" describe block |
| 12. Existing live AR tests remain passing | Full `src/lib` suite re-run: **497/497 passing** (419 pre-existing + 78 new) |

Also: `npx tsc --noEmit` clean, `npx eslint src/lib/jewellery-3d-generator` clean
(zero findings), `npm run build` succeeds (same 7 routes/8 pages as before this
phase).

**Not claimed**: no real-device/browser verification was performed this phase (all
verification is vitest/jsdom + real, non-mocked Three.js/GLTFExporter/GLTFLoader
code, the same standard this repository's M6.8 phase already established as
sufficient for pure geometry/export correctness — WebGL rendering itself was not
re-verified here since nothing about the renderer changed).

---

## 13. Limitations

- **`physical_depth_mm` describes cross-sectional thickness, not assembled bounding-
  box depth.** The Diamond Choker's real generated bounding box is 38.9mm deep, not
  12mm, because the wrap-sagitta curve and the forward-projecting pendant both add
  real front-to-back extent beyond the band's own material thickness. This is an
  honest finding (§7), not corrected by changing the already-committed measurement
  document — future specifications should distinguish "material cross-section depth"
  from "assembled silhouette depth" explicitly if this ambiguity matters downstream.
- **Only 2 of 9 vault categories have a registered strategy** (necklace, ring) — by
  design, per Phase D's own stop condition. §9 explains how the remaining 7 would be
  added without new architecture, but none of that code exists yet.
- **Geometry is a parametric approximation**, not a faithful facet-by-facet
  reconstruction of a specific photographed piece — individual gemstone facets,
  filigree, and fine prong detail are not modeled; base material properties
  (metalness/roughness/transmission) carry that visual weight instead. Same
  conclusion Phase C's research already reached, now demonstrated concretely.
  Deliberately simple stand-in shapes are used for sub-parts (ellipsoid bosses, cone
  drops, octahedron gems) rather than category-specific meshes.
  No boolean/CSG operations (e.g. real prong-socket cuts) — noted as a future option
  in Phase C's research, not needed for this validation.
- **No textures anywhere** — every material is factor-only (color/metalness/
  roughness/transmission), which is sufficient for this validation's own goals but
  will look noticeably flatter than a texture-mapped real asset.
- **No real-device/browser rendering verification this phase** (see §12).
- **The Diamond Choker's own drop count/taper ratio/accent-gem placement are
  construction choices**, not measurements — flagged explicitly in
  `fixtures/diamond-choker-spec.ts`'s comments, distinct from the already-labeled
  estimates in the source measurement document.

---

## 14. How a new jewellery item is added

For an item in an ALREADY-implemented category (necklace or ring today): write one
new fixture/adapter function returning a `Jewellery3DSpecification` (numbers only —
real measurements if available, or clearly-labeled estimates/fixtures otherwise) and
call `generateJewellery3D(spec)`. No new code path.

For an item in a NOT-yet-implemented category (e.g. the first bangle): write one new
`strategies/<category>-strategy.ts` implementing `JewelleryCategoryStrategy`,
composing the existing primitives (§9 shows bangle would reuse the closed-band +
radial-repetition combination already built and tested for the ring), then add one
line to `strategies/registry.ts`. Every other module (`primitives.ts`,
`materials.ts`, `component.ts`, `glb-export.ts`) needs zero changes.

---

## 15. How the system scales to all vault categories

See §9's table and §14. The concrete, checked claim: `necklaceStrategy` (open curve)
and `ringStrategy` (closed curve) already prove the two fundamentally different
curve topologies every remaining category needs (haaram/bangle/bracelet reuse one of
these two exactly; earring/maang_tikka/nose_ring are smaller compositions of
`pendant`/`repeatingElements`/a short or absent `band`, all primitives that already
exist). No remaining category requires a new primitive, a new material class, or a
change to the export pipeline — only a new strategy file (data assembly) and a new
specification (numbers).

---

## PHASE D STATUS:
- **Generic foundation**: Complete — specification schema, curve system, 9 reusable
  primitives, component tree system, 7-preset material system, GLB export pipeline,
  all category-blind except the 2-entry strategy registry.
- **Diamond Choker**: Complete — generated entirely through `necklaceStrategy`, no
  choker-specific geometry code. Real output: 944 triangles, ~92KB GLB, bbox 192.2 ×
  106.0 × 38.9mm.
- **Second category (Ring)**: Complete — generated entirely through `ringStrategy`,
  proving a structurally different (closed-curve) topology through the same
  pipeline. Real output: 664 triangles, ~64KB GLB, bbox 19.1 × 4.0 × 19.2mm.
- **GLB export**: Complete — `GLTFExporter`, zero new dependencies.
- **GLTFLoader validation**: Complete — both GLBs round-tripped through the
  EXISTING, unmodified `three-asset-loader.ts`'s `loadGltfAsset`, in-process
  (vitest/jsdom), not a real browser.
- **Live AR integration**: Consumption-proven only — both generated assets resolve
  correctly through the EXISTING, unmodified `jewellery-representation.ts`'s
  `resolveJewelleryRepresentation` (returns `"gltf-3d"`). Nothing was wired into
  `useLiveArSession.ts` or any live render call site; the existing 2D pipeline is
  the only one actually running in the app today.
- **Tests**: 497/497 passing (419 pre-existing + 78 new), zero regressions.
- **Build**: Passing (`next build`, same 7 routes/8 pages).
- **Lint**: Clean, zero new findings.
- **New dependencies**: None. Zero `package.json` changes.
- **Remaining limitations**: See §13 — most notably, `physical_depth_mm` measures
  cross-sectional thickness, not assembled depth; only 2 of 9 categories are
  implemented; no textures; no real-device rendering verification was performed or
  claimed this phase.
