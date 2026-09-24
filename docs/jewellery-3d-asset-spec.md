# Jewellery 3D Asset Specification (M6.8)

Written against the M6.8 request's Steps 20-21. This is what a 3D artist/modeler must
deliver for the **first** production 3D jewellery item — the Diamond Choker (M6.8
Step 6/22's Phase A target) — before the live 3D rendering path
(`apps/web/src/lib/live-ar/three/`) can be visually validated on a real camera. No
such asset exists in this repository as of this writing (confirmed by direct search —
see `docs/live-ar-realism-verification.md`'s M6.8 section); this document exists so
one can be commissioned/produced correctly the first time.

## 1. Model format

**GLB (binary glTF 2.0)**, not separate `.gltf` + textures. A single self-contained
file is simpler to store/version/deliver through this catalogue's existing private
object-storage architecture (see §5 below) than a multi-file `.gltf` + `.bin` + PNG
texture bundle.

## 2. Required geometry properties

- **Real jewellery geometry** — modeled from actual measurements or CAD, not
  extruded/guessed from a single front photo (see §7's workflow — a flat photo alone
  cannot produce an accurate 3D model; this is the same conclusion
  `docs/live-ar-3d-representation-assessment.md`'s Step 1 audit reached about why a
  flat PNG can't fake 3D in the renderer either — it's equally true for the *asset*
  itself).
- **Actual thickness** — the choker band must have real depth (a Z-extent), not a
  paper-thin plane. This is the property this milestone's live rendering foundation
  (`three-transform.ts`) has nothing to compensate for if it's missing: the renderer
  trusts the mesh's own geometry entirely.
- **Actual curvature around the neck** — the model's own vertices define the
  choker-around-a-neck shape. `apps/web/src/lib/live-ar/three/` deliberately does
  **no** per-vertex deformation (unlike the 2D pipeline's `jewellery-deformation.ts`
  strip-warp) — see the M6.8 request's Step 11 and the assessment doc's Step 3: the
  curvature must be baked into the mesh by the artist, not synthesized at render time.
- **Physically plausible dimensions** — matching the catalogue item's real
  `physical_width_mm`/`physical_height_mm`/`physical_depth_mm` (already real DB
  columns on `Jewellery` — see §5). The renderer (`three-transform.ts`'s
  `computeMeshScaleFactor`) rescales the mesh to match these exactly, so the asset's
  OWN authored scale doesn't need to be millimeter-perfect, but its **proportions**
  (width:height:depth ratio) must be accurate, since a uniform rescale can't fix a
  wrong aspect ratio.
- **Centered, clean origin/transforms** — the mesh's local origin should sit at (or
  very near) the intended attachment point (§4 below). No un-applied/baked-in scale,
  rotation, or translation on the root node left over from the authoring tool (e.g. a
  Blender export with a leftover 90° X-axis rotation from Blender's own Z-up
  convention — glTF is Y-up; make sure the exporter's axis conversion is applied, not
  left for this pipeline to guess at).
- **Correct normals** — outward-facing, consistent winding order (required for
  `MeshStandardMaterial`'s lighting to look right at all, not just plausible).
- **Optimized topology** — no unnecessarily dense mesh; see §6 (performance).

## 3. Material

**glTF PBR metallic-roughness**, authored directly in the modeling tool (Blender's
"Principled BSDF" material maps 1:1 onto glTF's metallic-roughness model and exports
correctly via Blender's own glTF exporter — no manual conversion needed). Required:
`baseColorFactor`/`baseColorTexture`, `metallicFactor` (≈1 for gold), `roughnessFactor`
(a real value informed by the actual piece's finish — polished vs. brushed gold have
meaningfully different roughness; do not default to 0, a physically implausible mirror
finish — see `three-materials.ts`'s `createFallbackGoldMaterial` for this pipeline's
own placeholder value, which exists ONLY as a fallback for an asset with literally no
material, never a substitute for the artist's own authored one).

Recommended (only where they add real value for the specific piece): a normal map (for
fine surface detail beyond what the geometry itself carries) and an ambient-occlusion
map (for contact-shadow detail between overlapping design elements, e.g. a filigree
choker). Do not add either speculatively — see §6.

## 4. Required metadata (delivered alongside the GLB, per-item)

| Field | Meaning | Consumed by |
|---|---|---|
| `width_mm` / `height_mm` / `depth_mm` | Real physical dimensions | Already-existing `Jewellery.physical_width_mm/height_mm/depth_mm` DB columns — reused, never duplicated (see `jewellery-representation.ts`'s `Gltf3dAssetMetadata`) |
| `attachment_point` | Where, in the mesh's own local space, the piece attaches to the body | `Gltf3dAssetMetadata.anchor` |
| `attachment_orientation` | Which local axis/direction the attachment point "faces" | `Gltf3dAssetMetadata.attachmentType` (free-text today; a numeric orientation convention can be added once a real asset needs one) |
| `category` | Existing catalogue category (e.g. "necklace") | Existing `JewelleryCategory` |
| `material` | Free-text description of the real material (e.g. "22k yellow gold, polished") | Informs (not replaces) the authored PBR values in §3 |

## 5. Delivery / storage

**3D assets must remain private**, using this project's EXISTING private object
storage architecture (`storage/s3_storage.py`'s `S3CompatibleStorage`, the same
signed-URL mechanism `apps/api/v1/services/asset_service.py` already uses for 2D
assets) — never a public URL. No new storage backend or access pattern is needed;
this is a new `storage_key`/asset-type value through the EXISTING upload/signed-URL
flow, mirroring exactly how a processed PNG is delivered today. (Wiring the actual
DB column/admin upload UI for this is explicitly not done in M6.8 — see the
verification doc's M6.8 section for why — this table documents the target shape for
whichever milestone adds it.)

## 6. Performance budget

- **Triangle count**: mobile/browser-suitable. A single small jewellery item should be
  well under 20,000 triangles — most well-modeled jewellery pieces (chokers, rings,
  earrings) can look correct in the low thousands; there is no need to approach that
  ceiling for a simple choker band.
- **Texture resolution**: reasonable for a small on-screen object (typically 512-1024px
  per map is plenty for something occupying a few hundred screen pixels — this pipeline
  never shows the piece full-screen). Do not ship unnecessary 4K/8K textures.
- **Compressed/optimized delivery where compatible**: e.g. Draco geometry compression
  or KTX2/Basis texture compression, IF the toolchain supports it — nice-to-have, not
  required for the first proof-of-concept asset.

## 7. Explicitly excluded from the GLB

Per the request's own instruction — do not include: animation, a background, a human
model/avatar, a camera, or lights (this pipeline provides its own camera and lighting —
`three-camera.ts`/`three-scene.ts` — a baked-in camera/lights in the asset would
conflict with them), or unnecessarily large textures (§6).

## 8. Recommended asset creation workflow

```
Jewellery CAD / real measurements
        |
        v
      Blender
        |
        v
  clean geometry (thickness, curvature, correct scale/origin)
        |
        v
       UVs
        |
        v
  gold PBR material (Principled BSDF: metallic, roughness)
        |
        v
  normal/AO maps -- only if the specific piece justifies them
        |
        v
     optimize (topology, texture size)
        |
        v
    GLB export (Blender's own glTF 2.0 exporter)
        |
        v
  browser validation (load it through this pipeline's
  three-asset-loader.ts, confirm it renders/scales/attaches correctly)
        |
        v
  catalogue registration (§5's storage flow)
```

**If the jewellery shop has real CAD files for the piece, use those as the source** —
they already encode the exact real-world geometry a photo cannot. **If accurate CAD
does not exist**, the model should be built from multiple reference photographs (front,
side, 3/4 views — not just the single front-facing product photo the current PNG
catalogue already has) plus exact physical measurements, by an artist/modeler
constructing real 3D geometry from those references. **A single front PNG cannot
produce an accurate physical 3D model automatically** — there is no tool or process
that recovers a necklace's true side profile, thickness, or back geometry from one
photograph; that information was never captured, the same fundamental limitation
`docs/live-ar-3d-representation-assessment.md` established for the *rendering* side.
