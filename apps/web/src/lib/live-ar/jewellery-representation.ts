/**
 * Jewellery representation contract (M6.7 spec Step 4, extended by M6.8 spec Step 5):
 * "Create a representation abstraction... the purpose is to allow the catalogue to
 * evolve from PNG only to PNG + 2.5D + 3D without rewriting the live AR system."
 *
 * WHY THIS EXISTS NOW, WITH NOTHING BEHIND "layered-2.5d"/"gltf-3d" YET: M6.7's audit
 * (docs/live-ar-3d-representation-assessment.md) concluded that a flat PNG cannot
 * represent genuinely new viewing angles/depth/thickness -- true "wearing" realism
 * under head rotation needs richer asset data than exists anywhere in this catalogue
 * today. M6.8 Step 4 explicitly forbids fabricating a 3D asset to prove that
 * conclusion further, so THIS module is the actual deliverable for the rendering
 * side: a real, tested seam the catalogue can grow into, decided ONCE, rather than
 * every future caller re-deriving "which representation does this item have."
 *
 * THE CONTRACT: `resolveJewelleryRepresentation` always returns "flat-2d" today,
 * because `db/models/jewellery_asset.py` (confirmed by direct schema inspection) has
 * no column for a 3D/layered asset reference -- there is nothing to select. When a
 * future migration adds one, this function's `input` type already has a slot for it
 * (`gltf3dAsset`) and its resolution order (3D > layered-2.5D > flat-2d) is decided
 * here, in ONE place, so no caller needs to re-implement "prefer 3D when available,
 * else fall back to the existing PNG renderer" (spec Step 18's fallback requirement)
 * themselves.
 *
 * M6.8 Step 5's metadata fields (`physicalWidthMm`/`physicalHeightMm`/
 * `physicalDepthMm`) deliberately REUSE the catalogue's own existing
 * `physical_width_mm`/`physical_height_mm`/`physical_depth_mm` columns (already
 * present on `Jewellery`/`JewelleryResponse` since Milestone 2, threaded into the 2D
 * pipeline since M6.5) -- never a second, duplicated dimension field, per spec Step
 * 5's own "do not duplicate catalogue information unnecessarily."
 *
 * DELIBERATELY NOT WIRED INTO THE RENDER LOOP YET: every branch besides "flat-2d"
 * would be dead code with a real 3D renderer to call (spec Step 4's own "do not
 * over-engineer"). useLiveArSession.ts continues calling asset-cache.ts/renderer.ts
 * directly, unchanged. A future milestone with a real 3D asset in hand wires this
 * resolver in at that point, branching on its `.type`, and calling into
 * `three/three-transform.ts`'s `computeThreeJewelleryTransform` for the gltf-3d case.
 */
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";

export type JewelleryRepresentationType = "flat-2d" | "layered-2.5d" | "gltf-3d";

/** M6.8 spec Step 5's 3D asset contract. Every field besides `modelUrl`/`modelFormat`
 * is either reused from the catalogue's existing physical-dimension columns, or an
 * OPTIONAL authoring correction that defaults to null (trust the GLB's own authored
 * values exactly) -- never an invented number. */
export interface Gltf3dAssetMetadata {
  modelUrl: string;
  modelFormat: "glb" | "gltf";
  /** Reused from JewelleryResponse.physical_width_mm/height_mm/depth_mm -- see this
   * module's file docstring. Null exactly when the catalogue item itself has no
   * physical dimensions set (same meaning as the 2D pipeline's own null case). */
  physicalWidthMm: number | null;
  physicalHeightMm: number | null;
  physicalDepthMm: number | null;
  /** Free-text, same convention as `JewelleryAsset.attachment_point` for the 2D
   * pipeline (e.g. "neck_choker") -- descriptive metadata only, never parsed for
   * control flow. */
  attachmentType: string | null;
  /** The mesh's own local-space attachment point (mirrors
   * `JewelleryAssetGeometry.anchorPx`'s role for the 2D pipeline, in 3D) -- where, in
   * the GLB's own authored coordinate system, the piece is considered "attached" to
   * the body. Null until a real asset + admin metadata convention populates it. */
  anchor: { x: number; y: number; z: number } | null;
  mirrorable: boolean;
  materialProfile: "pbr-metallic-roughness" | null;
  /** Admin-supplied CORRECTIONS for an asset whose own authored scale/orientation
   * doesn't match this pipeline's convention -- never invented, never required. Null
   * means "trust the GLB exactly as authored," the default and expected case. */
  scaleCorrection: number | null;
  rotationCorrectionDegrees: { yawDegrees: number; pitchDegrees: number; rollDegrees: number } | null;
  /**
   * Generic distinction (docs/diamond-choker-asset-restoration.md): a 3D asset
   * existing is NOT the same claim as a 3D asset being an accurate, reviewed
   * representation of the real jewellery. `true` only once a human has looked at
   * this specific asset rendered and confirmed it actually depicts the piece --
   * never set to `true` merely because a GLB (procedurally generated or otherwise)
   * happens to exist. `resolveJewelleryRepresentation` below treats `false` exactly
   * like "no gltf3dAsset at all," falling back to the existing 2D/2.5D
   * representations -- the SAME rule `three-live-bridge.ts`'s own registry enforces
   * at the live-render call site, so a future real database column backing this
   * field would only need to feed both places the same value, never two different
   * gating mechanisms.
   */
  productionVerified: boolean;
}

/** Everything about one loaded jewellery item that COULD inform which representation
 * to use. Only `flatAsset` is ever populated today -- the other two fields exist so
 * this type doesn't need to change shape when the catalogue eventually gains one of
 * them; they are typed as always `null`/`undefined` right now, never fabricated. */
export interface JewelleryRepresentationInput {
  flatAsset: { image: HTMLImageElement; geometry: JewelleryAssetGeometry } | null;
  /** Not exposed by the catalogue schema today (no column exists) -- see this
   * module's file docstring. Always null/undefined until a real migration adds one. */
  gltf3dAsset?: Gltf3dAssetMetadata | null;
  /** Same status as `gltf3dAsset` -- no layered/multi-view asset field exists yet. */
  layeredAssetUrls?: string[] | null;
}

export interface JewelleryRepresentation {
  type: JewelleryRepresentationType;
  flatAsset: { image: HTMLImageElement; geometry: JewelleryAssetGeometry } | null;
  gltf3dAsset: Gltf3dAssetMetadata | null;
  layeredAssetUrls: string[] | null;
}

/** Resolution order: gltf-3d > layered-2.5d > flat-2d -- richer representations win
 * when present AND `productionVerified` (spec Step 18's "3D asset available? YES ->
 * use 3D, NO -> use current 2D/2.5D renderer" -- "available" means verified, not
 * merely existing; see `Gltf3dAssetMetadata.productionVerified`'s own doc comment).
 * An unverified gltf3dAsset is treated exactly like no gltf3dAsset at all -- never a
 * partial/degraded 3D representation. Pure -- safe to call once per loaded item,
 * same discipline as jewellery-attachment.ts's resolveNecklaceAttachmentModel. */
export function resolveJewelleryRepresentation(input: JewelleryRepresentationInput): JewelleryRepresentation {
  const gltf3dAsset = input.gltf3dAsset && input.gltf3dAsset.productionVerified ? input.gltf3dAsset : null;
  const layeredAssetUrls = input.layeredAssetUrls ?? null;

  if (gltf3dAsset) {
    return { type: "gltf-3d", flatAsset: input.flatAsset, gltf3dAsset, layeredAssetUrls };
  }
  if (layeredAssetUrls && layeredAssetUrls.length > 0) {
    return { type: "layered-2.5d", flatAsset: input.flatAsset, gltf3dAsset: null, layeredAssetUrls };
  }
  return { type: "flat-2d", flatAsset: input.flatAsset, gltf3dAsset: null, layeredAssetUrls: null };
}
