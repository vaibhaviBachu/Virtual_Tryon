# Programmatic Jewellery → GLB Generation Research (Phase C)

**Status: RESEARCH ONLY — NOTHING IN THIS DOCUMENT HAS BEEN IMPLEMENTED.**

No packages were installed, no `package.json` was modified, no source code was
written, and no GLB was generated while producing this document. Per the request,
Blender, Rhino, MatrixGold, SolidWorks, and other external CAD/3D modelling
applications were explicitly excluded from consideration.

---

## 1. Executive summary

We can build a real, programmatic 2D-measurement-spec → GLB pipeline entirely
ourselves, using **only** what is already installed in this repository:
Three.js's own geometry primitives (`BufferGeometry`, `CatmullRomCurve3`,
`ExtrudeGeometry`, `LatheGeometry`) to construct real 3D volume, and Three.js's own
`GLTFExporter` (already present at `three/examples/jsm/exporters/GLTFExporter.js`,
the sibling of the already-used `GLTFLoader.js`) to serialize it to a valid binary
GLB. This requires **zero new npm dependencies** — `three` is already a
dependency (`^0.186.1`), and this repository has already proven, in its own M6.8
test suite, that `GLTFExporter.parseAsync(scene, { binary: true })` produces a
real, loadable GLB entirely offline (the `data:` URL round-trip technique in
`three-asset-loader.test.ts`). The generator would reuse that exact technique, not
invent a new one.

The direct answer to the framing question — *"Can we generate our own jewellery 3D
geometry without Blender/CAD and feed the resulting GLB directly into our existing
Three.js live AR pipeline?"* — is **YES, WITH LIMITATIONS** (Step 7 below). The
output is a plausible, correctly-scaled, correctly-curved, real-3D-volume
*parametric approximation* of the piece, not a faithful facet-by-facet
reconstruction of the exact photographed item. That is consistent with this
project's own established position (`docs/live-ar-3d-representation-assessment.md`,
`docs/jewellery-3d-asset-spec.md` §8) that a single 2D photo cannot yield a
manufacturing-accurate 3D model — this pipeline doesn't change that fact, it just
gives us a legitimate way to get a real, testable 3D asset into the M6.8 renderer
without waiting on external CAD/artist tooling.

---

## 2. Current repository audit (Step 1)

Read-only inspection performed; nothing below was changed.

| Item | Finding |
|---|---|
| Three.js version | `three@^0.186.1` (`apps/web/package.json`), `@types/three@^0.186.0` — already installed |
| GLTFLoader usage | `apps/web/src/lib/live-ar/three/three-asset-loader.ts` imports `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`, caches the parsed master scene per URL, clones per instance, disposes only on cache eviction |
| GLTFExporter availability | `three/examples/jsm/exporters/GLTFExporter.js` exists in `node_modules` alongside the loader — same package, same license, no separate install. Confirmed it contains `KHR_materials_transmission` support, relevant for a diamond-like stone material later |
| WebGL renderer architecture | `three-renderer.ts`/`three-camera.ts`/`three-scene.ts` — a direct Three.js WebGL2 setup (no React Three Fiber, no WebGPU); unrelated to asset *generation*, only to asset *display* |
| Live AR coordinate system | `three-types.ts`: millimeters, right-handed, +Y up, camera forward −Z, camera at world origin. Documented explicitly and must be matched by anything a generator produces |
| Jewellery representation contract | `jewellery-representation.ts`'s `Gltf3dAssetMetadata`/`resolveJewelleryRepresentation` — already has a `modelUrl`/`modelFormat: "glb"` slot waiting for a real asset; a generated GLB would plug into this exact contract, unchanged |
| Asset loading/caching | `loadGltfAsset`/`cloneGltfInstance`/`clearGltfAssetCache` in `three-asset-loader.ts` — already built, already tested, requires no changes to consume a generated GLB |
| TypeScript version | `typescript@^5` (`apps/web/package.json`), `tsconfig.json` targets ES2017, `moduleResolution: "bundler"`, strict mode on |
| Build tooling | Next.js `16.3.5` for the app; no monorepo root `package.json` — `apps/web` and the Python `apps/api`/`workers` are independent projects, not npm workspaces |
| Test tooling | `vitest@^5.0.1`, `jsdom` environment, `@vitejs/plugin-react`; `vitest.config.ts` has no `root` override, so `apps/web` is always the working directory for tests |
| Script runner availability | **No `tsx` / `ts-node` dependency exists today.** Node version in this environment is **v24.12.0**, which supports running `.ts` files directly (native type-stripping, no flag needed on Node ≥23.6) for syntax that doesn't require full transformation (no enums/namespaces/parameter-property sugar). This means a generator script could plausibly run via plain `node generator.ts` with **no new dependency**, though this is a Step-16 implementation-phase decision, not resolved here |
| Reusable geometry/deformation utilities | `jewellery-deformation.ts` (2D strip-warp) and `neck-projection.ts`/`neck-surface.ts` (2D elliptical neck curvature) are 2D-canvas-specific and not directly reusable for 3D mesh generation, but their underlying IDEA — model the neck as an ellipse/curve and place jewellery elements along it — carries over directly as the geometric basis for the 3D band's sweep curve (Step 4) |
| Python worker dependencies | `workers/requirements.txt` already has `numpy`, `scipy`, `Pillow` (for 2D image morphology), but **no** `trimesh`, `pygltflib`, or any 3D mesh library today |
| Existing prototype spec | `docs/diamond-choker-prototype-measurements.json`/`.md` — the actual input this generator would consume; already validated by 8 passing tests (`diamond-choker-prototype-measurements.test.ts`) |

---

## 3. Candidate tools (Step 2)

### A/D. TypeScript/JavaScript — geometry generation

| Name | Language | License | Commercial use | Custom mesh | Normals | UVs | PBR | Curves/splines | Maintained | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Three.js core** (`BufferGeometry`, `CatmullRomCurve3`, `ExtrudeGeometry`, `LatheGeometry`, `Curve.computeFrenetFrames`) | TS/JS | MIT | Yes | Yes (full control) | Yes (`computeVertexNormals`, or authored manually) | Yes (authored manually or via `ExtrudeGeometry`'s UV generator) | Yes (`MeshStandardMaterial`/`MeshPhysicalMaterial`) | Yes (`CatmullRomCurve3`, `CurvePath`) | Yes, very actively | **Already installed.** Zero new dependency. Already the exact material/geometry classes this pipeline's renderer already consumes |
| **three-bvh-csg** (gkjohnson) | TS/JS | MIT | Yes | Yes (boolean ops on existing meshes) | Yes | Preserved from inputs | N/A (geometry only) | N/A | Yes, actively (same author as `three-mesh-bvh`, widely used) | Useful later for cutting stone-socket recesses into a band; not needed for a first swept-profile prototype |
| **manifold-3d** (npm) | WASM + TS bindings | Apache-2.0 | Yes | Yes (robust boolean CSG) | Yes | Preserved | N/A | N/A | Yes, actively (also used by OpenSCAD/Blender's own newer boolean backend, though we are not using Blender) | Heavier (WASM binary, ~hundreds of KB to 1MB+). Overkill for a first prototype; worth revisiting once designs need real boolean cuts (e.g. prong sockets) |
| **@gltf-transform/core** + `/functions` (Don McCurdy) | TS/JS | Apache-2.0 | Yes | N/A (post-processes an existing glTF document; does not generate mesh geometry itself) | Preserved/validated | Preserved/validated | Preserved/validated | N/A | Yes, actively (maintained by a core glTF ecosystem contributor) | Best-in-class for **optimizing** an already-exported GLB (Draco geometry compression, KTX2 texture compression, pruning/deduping). Not a mesh *generator* — would sit as an optional later step after Three.js/GLTFExporter produces the raw GLB |

### B. Python ecosystem

| Name | Language | License | Commercial use | Custom mesh | Normals | UVs | PBR | Curves/splines | Maintained | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **trimesh** | Python | MIT | Yes | Yes (primitives + `sweep_polygon`, extrusion, booleans via optional backend) | Yes | Partial (UV support is weaker than authoring in Three.js directly) | Via glTF material export, but PBR authoring ergonomics are secondary to a geometry-first API | Yes (path sweeping) | Yes, actively | Exports `.glb` directly (`mesh.export(file_type="glb")`). Good fit only if the generator lived in the Python `workers/` service instead of `apps/web` — see §9 for why we don't recommend that split |
| **pygltflib** | Python | MIT | Yes | Only if you build vertex/index arrays yourself (low-level glTF document writer, not a mesh generator) | Manual | Manual | Manual | N/A | Yes, maintained but slow-moving | Lower-level than `trimesh`; would still need a mesh-generation layer on top. No advantage over `trimesh` for this task |
| **Open3D** | Python (C++ core) | MIT | Yes | Yes | Yes | Partial | Limited | Limited | Yes, actively | Heavy dependency (large wheel, bundles visualization/GUI code this project would never use). Not a good fit |
| **CadQuery** / **build123d** (OCCT-based) | Python | Apache-2.0 | Yes | Yes — true parametric CAD (fillets, lofts, shells, sweeps) | Yes | Via tessellation export | Not native (would need conversion) | Yes | Yes, actively | **Excluded per the explicit instruction to avoid CAD systems.** Not a GUI application, but it *is* a CAD kernel in spirit (OCCT, the same geometry kernel behind several commercial CAD tools) — listed here for completeness, not recommended as the primary path |

### C. Custom / zero-dependency GLB writing

| Option | Verdict |
|---|---|
| Hand-write the glTF 2.0 JSON + binary chunk container from typed arrays, with no library | **Rejected.** This reimplements exactly what `GLTFExporter` already does correctly (4-byte buffer alignment, `JSON`/`BIN\0` chunk headers, accessor `min`/`max` bounds, sparse-accessor edge cases) for zero benefit — `GLTFExporter` is free, MIT-licensed, and already installed |
| Use Three.js primitives for geometry + Three.js's own `GLTFExporter` for the container | **Recommended** — see §6/§9. This is the "zero/low-dependency" option the request asked us to specifically investigate, and it turns out to already be fully available |

---

## 4. Licensing analysis (Step 10)

| Dependency | License | Commercial use permitted | Attribution required | Copyleft | Verdict |
|---|---|---|---|---|---|
| `three` (incl. `GLTFExporter`/`GLTFLoader`) | MIT | Yes | Standard MIT notice retention (already satisfied — it's an existing dependency, no new obligation) | No | Safe, already in use |
| `three-bvh-csg` (if adopted later) | MIT | Yes | Standard MIT notice | No | Safe, if/when adopted |
| `manifold-3d` (if adopted later) | Apache-2.0 | Yes | Standard NOTICE retention | No | Safe, if/when adopted |
| `@gltf-transform/core`/`functions` (if adopted later) | Apache-2.0 | Yes | Standard NOTICE retention | No | Safe, if/when adopted |
| `trimesh` (Python, not recommended — see §9) | MIT | Yes | Standard MIT notice | No | Safe if ever adopted, just not recommended here |
| CadQuery/build123d | Apache-2.0 | Yes | Standard NOTICE retention | No | License itself is safe; **excluded on architectural/instruction grounds, not licensing grounds** |

No candidate considered anywhere in this research carries a copyleft (GPL/AGPL) or non-commercial license. **The recommended approach (§9) introduces zero new dependencies of any license**, since it uses only the `three` package already present in `apps/web/package.json`.

---

## 5. Programmatic GLB generation feasibility (Step 7 — direct answer)

**YES, WITH LIMITATIONS.**

We can realistically build a jewellery GLB generator ourselves, using only
Three.js (already installed) for both geometry construction and GLB export,
executed as a small build-time Node/TypeScript script that is completely separate
from the live AR runtime.

**Why "yes":**
- All required primitives already exist in an already-installed package: swept/curved
  geometry (`CatmullRomCurve3` + custom cross-section sweep, or `ExtrudeGeometry`/
  `LatheGeometry` for simpler sub-parts), real per-vertex normals, PBR materials
  matching the glTF metallic-roughness model this pipeline already expects, and a
  GLB exporter this repository has already proven (in its own tests) to produce
  real, loadable binary GLBs.
- The output slots directly into code that already exists and needs no changes:
  `three-asset-loader.ts`'s `loadGltfAsset`, `three-transform.ts`'s scale/attachment
  math, and `jewellery-representation.ts`'s `Gltf3dAssetMetadata` contract.
- It requires zero new npm dependencies and no CAD/modelling application.

**Why "with limitations":**
- The result is a **parametric approximation**, not a faithful reconstruction of
  the exact photographed piece. A swept band + procedurally placed drops + a
  simplified pendant will look like *a* diamond choker, not necessarily *this
  exact* diamond choker down to every prong and facet.
- Individual gemstone facet-level detail (dozens of tiny brilliant-cut facets per
  stone) is impractical to author procedurally at a sane triangle budget; realistic
  stone sparkle is better achieved later through material properties
  (`roughness`, `metalness`, `MeshPhysicalMaterial`'s `transmission`/`ior`) or a
  normal map than through more geometry.
- This does not produce a manufacturing-accurate model and should not be treated
  as one — it is explicitly a **live-AR rendering prototype tool**, matching the
  stated objective ("continue building and testing the M6.8 Three.js pipeline"),
  not a jewellery-CAD replacement.
- Given the current repository and no external deadline pressure mentioned in this
  request, the "with limitations" framing is a description of the technique's
  ceiling, not a schedule risk.

---

## 6. Recommended approach

**Three.js native geometry primitives + Three.js's own `GLTFExporter`, run as a
build-time Node/TypeScript script, entirely inside the existing `apps/web`
project. Zero new npm dependencies.**

Concretely:

1. **Geometry**: a custom swept-profile technique — sample a `CatmullRomCurve3`
   built from the measurement spec's curvature/sagitta values, use
   `Curve.computeFrenetFrames` to orient a flat cross-section polygon (carrying the
   band's real width/thickness) at each sample point, and connect adjacent
   cross-sections into triangles (a standard "generalized cylinder" sweep — see
   §8 for why this beats a raw `TubeGeometry` or a flat extrusion for this specific
   shape).
2. **Sub-parts**: smaller composed primitives for the central pendant (a
   `LatheGeometry` boss + simple faceted stone shapes) and the drop fringe
   (repeating small teardrop `LatheGeometry` revolves, graduated in length,
   positioned along the same curve).
3. **Materials**: two `MeshStandardMaterial`/`MeshPhysicalMaterial` instances —
   gold (reusing `three-materials.ts`'s existing `createFallbackGoldMaterial`
   values as the starting point) and stone (low metalness, low roughness, optional
   `transmission`/`ior`) — no textures required for a first pass.
4. **Export**: `GLTFExporter.parseAsync(scene, { binary: true })`, the exact
   technique already proven in `three-asset-loader.test.ts`'s offline round-trip
   tests, writing a real `.glb` file to disk.
5. **Validation**: load the generated file back through the SAME
   `three-asset-loader.ts`/`GLTFLoader` the live runtime uses, and check it against
   the measurement spec's own target dimensions/aspect ratio (mirrors how
   `diamond-choker-prototype-measurements.test.ts` already validates the JSON spec
   against itself).

---

## 7. Why this was selected

- **Already installed, already proven.** `three` is an existing dependency, and
  this exact GLB-serialization technique (`GLTFExporter` → binary → real
  `GLTFLoader` round-trip, entirely offline) was already discovered and used
  successfully in this repository's own M6.8 test suite. Choosing it means reusing
  a technique this codebase has already validated, not introducing an unproven one.
- **Single source of truth for the coordinate contract.** `three-types.ts` already
  defines mm units, +Y up, right-handed, −Z camera-forward. A generator written in
  the same TypeScript/Three.js environment can construct geometry directly in that
  convention with no translation layer — a Python or CAD-kernel generator would
  require re-deriving/re-verifying that same convention in a second language,
  exactly the kind of "two places to keep in sync" risk this project has explicitly
  avoided at every prior milestone (`neck-projection.ts`/`three-transform.ts`'s
  "one source of truth for the transform" principle applies here too).
  See [[three-types.ts's coordinate contract]].
- **Zero new dependencies.** No `package.json` change, no new license to audit, no
  new install/build-time cost.
- **Directly reuses existing, tested downstream code.** `three-asset-loader.ts`,
  `three-transform.ts`, `three-materials.ts`, and `jewellery-representation.ts` all
  already exist and need no changes to consume the generator's output.
- **Generalizes.** The curve + cross-section-sweep + repeating-element technique is
  not specific to chokers (see §15).

---

## 8. Why alternatives were rejected

| Alternative | Why not chosen |
|---|---|
| Raw `THREE.TubeGeometry` for the band | Circular cross-section only — cannot represent a flat, wide bib-style band's real proportions (band thickness ≠ band depth in this piece); a custom swept cross-section gives that control for negligible extra complexity |
| Manual, from-scratch GLB binary container | Reinvents `GLTFExporter`, which already exists, is free, and is already proven working in this repo. Pure downside, no upside |
| Python + `trimesh`, run in the `workers/` service | Would require re-implementing/re-verifying the exact `three-types.ts` coordinate convention in a second language and a second geometry stack, and would still need its output loaded and validated through the SAME Three.js `GLTFLoader`/`three-asset-loader.ts` at the end anyway — no benefit over generating it in TypeScript directly, and a real cross-language consistency risk |
| CadQuery / build123d | Explicitly excluded — these are CAD kernels, which the request specifically asked us not to assume, even though they are pip-installable rather than GUI applications |
| `three-bvh-csg` / `manifold-3d` boolean CSG for stone sockets | Adds a real dependency and real complexity for a capability (true boolean prong-socket cuts) the first prototype does not need — the swept-profile + separately-placed-stone-primitive approach achieves a visually credible result without it. Worth reconsidering for a LATER, higher-fidelity pass, not the first prototype |
| `@gltf-transform` for the actual export | It optimizes/post-processes an existing glTF document; it does not generate mesh geometry. Not a substitute for `GLTFExporter`, only a possible later addition on top of it (Draco/KTX2 compression) once file size ever becomes a real concern (§13 suggests it currently won't) |

---

## 9. Proposed Diamond Choker geometry architecture (Step 4)

Using `docs/diamond-choker-prototype-measurements.json` as the input, the piece
decomposes into:

1. **Main curved band** — the dominant volume. Built as a **swept profile along a
   parametric curve**, not a flat extrusion or a circular tube:
   - A `CatmullRomCurve3` built from a handful of control points encoding the
     choker's front curvature AND the `horizontal_wrap_sagitta_mm` pull-back at
     the ends — one continuous curve drives both, rather than two separate
     curvature systems.
   - At each sampled point along the curve, `Curve.computeFrenetFrames` gives a
     stable local orientation; a flat rectangular (or gently rounded-corner)
     cross-section polygon — carrying the real `band_thickness_mm`-derived width
     and `physical_depth_mm` depth directly as its own polygon dimensions — is
     placed and oriented at each frame.
   - Adjacent cross-sections are connected into quads (triangulated), giving a
     genuine swept 3D solid whose curvature, thickness, AND depth are all real
     mesh geometry — never faked at render time, which is exactly what
     `docs/jewellery-3d-asset-spec.md` §2 already requires of any GLB this
     pipeline renders.
2. **Central pendant** — a small separate composed mesh (a `LatheGeometry`-revolved
   boss for the gold medallion setting + a simple faceted stone primitive for the
   square-cut diamond), sized from `central_pendant_width_mm`/`_height_mm` and
   positioned at the sweep curve's horizontal midpoint, at the band's own surface.
3. **Drop fringe** — repeating small teardrop shapes (`LatheGeometry` revolves of a
   simple teardrop 2D profile), graduated in length per `drop_length_mm` (longest
   at center, shorter toward the sides — matching the real row-fill-fraction
   measurement already documented in the measurement spec), positioned along
   sample points on the band's lower edge.
4. **Accent gemstones** — a handful of simple low-poly faceted primitives (e.g. an
   octahedron/bipyramid shape, not hundreds of individually modeled facets — see
   §5's limitation) at visually salient points, primarily the central pendant;
   the base gold material's own color/roughness — not additional geometry — is
   what should convey "dense stone cluster" across the rest of the band at this
   fidelity level.
5. **Depth** is not a separate step — it is a direct property of the cross-section
   polygon chosen in step 1, and of the drop/pendant primitives' own authored Z
   extent.

**Why the swept-profile approach over the alternatives** (balancing realism,
geometry quality, performance, implementation complexity, and reuse for future
designs):

| Approach | Realism | Quality | Performance | Complexity | Reusable for other jewellery? |
|---|---|---|---|---|---|
| Flat plane + texture (what the 2D pipeline already does) | Rejected outright — this is exactly the "not real 3D volume" problem M6.7/M6.8 exist to move past | — | — | — | — |
| `ExtrudeGeometry` of a flat 2D silhouette (no curve-following sweep) | Medium — gets real depth, but the band would be straight, not neck-curved, unless combined with a bend deformer | Medium | High | Low | Limited — a straight extrusion doesn't generalize to bangles/rings (closed curves) |
| Raw `TubeGeometry` along a curve | Low for THIS piece — forces a circular cross-section, wrong for a flat wide band | Medium | High | Low | Partial |
| **Custom swept cross-section along a `CatmullRomCurve3` (chosen)** | High — real curvature, real thickness, real depth, the cross-section shape is fully controllable | High | High (a few thousand triangles, see §11) | Medium (Frenet-frame sweep math, well-understood/standard technique) | **High** — same technique covers necklaces (thinner profile), haaram (longer curve, more tiers), bangles/bracelets/rings (closed curve instead of open arc) — see §15 |
| Full parametric CAD (CadQuery/build123d) | Highest achievable without real scan/CAD data | Highest | High (build-time only) | Highest (new toolchain, new language idioms, OCCT dependency) | High, but excluded per instruction (§3/§8) |

---

## 10. Proposed material architecture (Step 5)

Minimum viable, glTF 2.0 PBR metallic-roughness, matching `docs/jewellery-3d-asset-spec.md`
§3 and reusing `three-materials.ts`'s existing fallback values as a starting point
rather than inventing new numbers from nothing:

| Material | Class | Key properties |
|---|---|---|
| Gold (band, pendant setting) | `THREE.MeshStandardMaterial` | `color: "#d4af37"` (existing fallback value), `metalness: 1`, `roughness: ~0.3-0.4` (polished-but-not-mirror, matching the existing fallback's own reasoning) |
| Stone (diamond) | `THREE.MeshPhysicalMaterial` | `metalness: 0`, `roughness: ~0.05-0.1`, optionally `transmission`/`ior` for a glass-like look — confirmed exportable via `GLTFExporter`'s `KHR_materials_transmission` support (§2) |

No texture maps are required for a first prototype (base-color/metalness/roughness
factors only) — consistent with `docs/jewellery-3d-asset-spec.md` §3's "do not add
[normal/AO maps] speculatively." Two materials total is enough for a visually
credible prototype at this fidelity level; this can grow later (e.g. a separate
material per stone color) without changing the pipeline architecture.

---

## 11. Proposed GLB generation pipeline (Step 8)

```
Jewellery prototype specification
(docs/diamond-choker-prototype-measurements.json)
        |
        v
  spec-to-curve            -- spec's curvature/sagitta/dimension fields
                               -> a CatmullRomCurve3 path + cross-section profile params
        |
        v
  band-geometry             -- swept cross-section along the curve -> BufferGeometry
  pendant-geometry          -- central pendant primitive(s)         -> BufferGeometry
  drop-geometry             -- repeating graduated drop elements    -> BufferGeometry[]
        |
        v
  materials                 -- gold + stone MeshStandardMaterial/MeshPhysicalMaterial
                               (reusing three-materials.ts's existing fallback values
                               as the starting point, not duplicating new numbers)
        |
        v
  assemble-scene            -- THREE.Group assembly: band + pendant + drops,
                               computeVertexNormals, origin placed at the spec's own
                               attachment_point_local, correct +Y/+Z/+X orientation
                               per three-types.ts
        |
        v
  export-glb                -- GLTFExporter.parseAsync(scene, { binary: true })
                               (the SAME technique already proven in
                               three-asset-loader.test.ts's offline round-trip tests)
                               -> write a real .glb file to disk
        |
        v
  Generated diamond-choker.glb
  (written to a local/build-output location for manual review --
   NOT auto-uploaded to storage or the database by this pipeline)
        |
        v
  EXISTING three-asset-loader.ts's loadGltfAsset   (unchanged)
        |
        v
  EXISTING three-transform.ts / three-renderer.ts  (unchanged) -- Live AR attachment
        |
        v
  EXISTING tracking.ts / segmentation.ts / occlusion.ts        (completely unchanged)
```

### Proposed repository structure (Step 8 — names and responsibilities only, not created)

| Proposed path | Responsibility |
|---|---|
| `apps/web/scripts/jewellery-glb-generator/spec.ts` | Types + a loader for a measurement-spec JSON like `diamond-choker-prototype-measurements.json` |
| `apps/web/scripts/jewellery-glb-generator/curve.ts` | Spec → `CatmullRomCurve3` (encodes curvature + wrap sagitta) |
| `apps/web/scripts/jewellery-glb-generator/band-geometry.ts` | Frenet-frame swept cross-section along the curve → `BufferGeometry` |
| `apps/web/scripts/jewellery-glb-generator/pendant-geometry.ts` | Central pendant composed primitive → `BufferGeometry` |
| `apps/web/scripts/jewellery-glb-generator/drop-geometry.ts` | Graduated repeating drop elements along the curve → `BufferGeometry[]` |
| `apps/web/scripts/jewellery-glb-generator/materials.ts` | Gold/stone `MeshStandardMaterial`/`MeshPhysicalMaterial` factories, reusing `three-materials.ts`'s existing values |
| `apps/web/scripts/jewellery-glb-generator/assemble.ts` | Composes the above into one `THREE.Group`, places the origin at the spec's attachment point |
| `apps/web/scripts/jewellery-glb-generator/export.ts` | `GLTFExporter` invocation + file write |
| `apps/web/scripts/jewellery-glb-generator/generate-diamond-choker.ts` | The actual entry-point script wiring the above together for this one item |

This mirrors the existing `apps/web/src/lib/live-ar/three/` module-per-responsibility
convention already used for the renderer side (`three-camera.ts`, `three-scene.ts`,
`three-materials.ts`, etc.) rather than inventing a new organizational pattern.
**None of these files have been created.**

---

## 12. Performance considerations (Step 11)

Rough estimate for the Diamond Choker specifically, at the triangle budget already
recommended in `docs/diamond-choker-prototype-measurements.md` §4 ("target low
thousands"):

| Component | Estimated triangles |
|---|---:|
| Band (swept profile, ~60 path segments × ~10-point cross-section) | ~1,200 |
| Central pendant (boss + stone primitives) | ~200–500 |
| Drop fringe (~15–20 low-poly teardrops) | ~600–800 |
| Accent gemstone primitives | ~100–200 |
| **Total (estimated)** | **~2,500–3,500 triangles** |

- **Materials**: 2 (gold, stone) → at most 2 draw calls for this object, likely
  fewer if geometry is merged by material.
- **Textures**: none required for v1 → negligible contribution to file size.
- **Estimated GLB size**: likely tens to ~150KB (geometry buffers only, no
  textures, at this triangle count) — comfortably small.
- **Browser loading time**: negligible; this repository's own tests already load
  comparable synthetic GLBs through the real `GLTFLoader` near-instantly.
- **Live AR impact**: the asset is loaded and cached once per session
  (`three-asset-loader.ts`'s existing discipline — never reloaded per frame), so a
  few thousand triangles adds essentially nothing to per-frame cost. The actual
  per-frame cost driver in this pipeline is MediaPipe tracking + 2D canvas
  compositing, unrelated to this mesh's polygon count at this scale. This
  comfortably stays well under the existing `docs/jewellery-3d-asset-spec.md` §6
  budget (<20,000 triangles, 512–1024px textures if any are ever added).

---

## 13. Limitations

- Produces a **parametric approximation**, not a faithful reconstruction of the
  exact photographed Diamond Choker (§5).
- Individual gemstone facet-level detail is impractical to generate procedurally
  at this triangle budget; better addressed later via material/texture work than
  more geometry.
- All input dimensions remain what `docs/diamond-choker-prototype-measurements.json`
  already declares them to be: **engineering estimates**, not real physical
  measurements — this generation approach does not change that status or make the
  numbers any more "real"; it only gives them a real 3D form to be rendered and
  tested with.
- This is a code-authored geometry tool for **live-AR rendering prototyping**, not
  a manufacturing-accurate CAD replacement, and should not be represented as one to
  any downstream consumer (catalogue, customers, or manufacturing).
- The swept-profile technique assumes a reasonably simple, roughly-planar band
  silhouette; a future jewellery item with genuinely complex topology (e.g. an
  open filigree lattice) would need a richer cross-section/segmentation model than
  described here, or the CSG tools noted in §3/§8 as later options.

---

## 14. Future jewellery-category extensibility (Step 12)

The same architecture (§9/§11) is a curve + cross-section-sweep + repeating-element
system, not a choker-specific one. It generalizes as follows — **not implemented
now**, only assessed for feasibility:

| Category | How the same system applies |
|---|---|
| Necklace | Same swept-band technique, thinner cross-section, typically no separate "drop fringe" tier |
| Haaram | Same curve, longer arc, more repeating drop/pendant tiers at intervals along it |
| Bangle / bracelet | Same swept-cross-section technique, but with a **closed** circular curve instead of an open arc |
| Ring | Same closed-curve sweep at a much smaller radius, usually one profile, possibly one pendant/stone setting |
| Earring | Little to no main curve — mostly a pendant + drop composition, reusing `pendant-geometry.ts`/`drop-geometry.ts` directly |
| Maang tikka | A thin chain curve (reusing the band-sweep machinery at minimal cross-section) + a single pendant element |
| Nose ring | A small closed loop, same closed-curve sweep as a ring/bangle at very small scale |
| Jewellery set | Composition of several of the above generators sharing one material palette (same gold/stone material factories, reused, not re-authored per item) |

The architecture supports this generalization; building the per-category
parameter presets and specific proportions for each is future work, not part of
this research phase.

---

## 15. Exact implementation plan for the next phase (Step 16, not started)

If/when approved to proceed past research:

1. Create `apps/web/scripts/jewellery-glb-generator/` with the module breakdown in
   §11's table.
2. Build the curve + swept-cross-section band geometry first (the dominant volume),
   validated visually and via the same real-GLTFExporter/GLTFLoader round-trip
   technique already used in `three-asset-loader.test.ts`.
3. Add the central pendant and drop-fringe sub-parts.
4. Add the two PBR materials.
5. Export a real `diamond-choker.glb`, load it back through the existing
   `three-asset-loader.ts`, and validate its bounding box/aspect ratio against
   `docs/diamond-choker-prototype-measurements.json`'s own target dimensions
   (mirrors the already-passing spec-consistency tests).
6. Only after that validation, decide (as a separate, explicit decision) whether/how
   to register the generated asset through the existing private storage flow
   (`docs/jewellery-3d-asset-spec.md` §5) and wire `jewellery-representation.ts`'s
   `gltf3dAsset` input for this one catalogue item.

Each of these remains gated on explicit approval, per this project's established
STOP-condition discipline.

---

## 16. Risks

- **Aesthetic risk**: a procedurally generated approximation may look noticeably
  more "generic"/stylized than the real photographed piece, especially for
  intricate filigree or dense pavé stone-setting patterns that this technique
  does not attempt to reproduce at the geometry level.
- **Scope-creep risk**: the curve-sweep system is general enough that it could
  tempt building out many jewellery categories at once; the plan in §15
  deliberately scopes the next phase to the Diamond Choker only.
- **Expectation risk**: because this produces a genuinely real, loadable 3D asset,
  there's a risk it gets mistaken for (or presented as) production-ready
  photorealistic jewellery. It is a rendering-pipeline validation prototype; the
  existing measurement doc's "prototype_estimated" labeling discipline should
  extend to the generated asset itself (e.g. a filename/metadata marker), a detail
  to decide explicitly if/when generation is approved.
- **No risk to existing systems**: because nothing here touches the renderer,
  tracking, occlusion, or database, there is no regression risk to the
  already-shipped 2D pipeline or the M6.8 3D foundation from doing this research.

---

## 17. NOT IMPLEMENTED IN THIS PHASE

- No packages installed.
- No `package.json` changes (in `apps/web`, `apps/api`, or `workers`).
- No source code created (no generator scripts, no new modules).
- No GLB file generated.
- No database changes.
- No API changes.
- No frontend changes.
- No changes to the existing live AR runtime, renderer, tracking, or occlusion code.
- No existing geometry deleted or replaced.
- The only file created in this phase is this document.

---

## PHASE C DECISION

- **Tool/library**: Three.js (`three`, already installed) — its native geometry
  primitives (`BufferGeometry`, `CatmullRomCurve3`, `Curve.computeFrenetFrames`,
  `LatheGeometry`) for mesh construction, plus its own `GLTFExporter`
  (`three/examples/jsm/exporters/GLTFExporter.js`) for GLB serialization.
- **License**: MIT (already covered by the existing `three` dependency).
- **Why**: Zero new dependencies; already proven in this repo's own tests (the
  offline `GLTFExporter` → `data:` URL → `GLTFLoader` round-trip); shares the
  exact coordinate/material conventions already established in
  `three-types.ts`/`three-materials.ts`; output requires no changes to the
  already-built `three-asset-loader.ts`/`three-transform.ts`/
  `jewellery-representation.ts`.
- **Expected dependencies**: None new.
- **Build-time or runtime**: Build-time only (an offline generation script; the
  live AR runtime is completely unaffected).
- **Can generate real 3D geometry**: Yes — real vertices/normals/UVs with genuine
  curvature, thickness, and depth, not a textured plane.
- **Can export GLB**: Yes — confirmed via this repository's own already-passing
  tests using the exact same exporter.
- **Commercially usable**: Yes — MIT license, no restrictions.
- **Estimated implementation difficulty**: Medium — the swept-cross-section/Frenet-frame
  technique is a standard, well-understood approach, but is new code for this
  repository (no existing 3D mesh-generation utility to build on, only 2D-canvas
  equivalents).
- **Next phase**: Build the generator per §15's plan, starting with the band
  geometry alone, gated on explicit approval to proceed past research.

## PHASE C STATUS: RESEARCH COMPLETE — AWAITING REVIEW

Do not proceed to implementation.
