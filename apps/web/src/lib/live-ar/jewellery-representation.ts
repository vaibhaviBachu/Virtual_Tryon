/**
 * Jewellery representation contract (M6.7 spec Step 4): "Create a representation
 * abstraction... the purpose is to allow the catalogue to evolve from PNG only to
 * PNG + 2.5D + 3D without rewriting the live AR system."
 *
 * WHY THIS EXISTS NOW, WITH NOTHING BEHIND "layered-2.5d"/"gltf-3d" YET: M6.7's own
 * Step 0/1 audit (docs/live-ar-3d-representation-assessment.md) concluded that a flat
 * PNG cannot represent genuinely new viewing angles/depth/thickness -- true "wearing"
 * realism under head rotation needs richer asset data than exists anywhere in this
 * catalogue today. Step 11 explicitly forbids fabricating a 3D asset to prove that
 * conclusion further, so THIS module is the actual M6.7 deliverable for the rendering
 * side: a real, tested seam the catalogue can grow into, decided ONCE, rather than
 * every future caller re-deriving "which representation does this item have."
 *
 * THE CONTRACT: `resolveJewelleryRepresentation` always returns "flat-2d" today,
 * because `db/models/jewellery_asset.py` (confirmed by direct schema inspection) has
 * no column for a 3D/layered asset reference -- there is nothing to select. When a
 * future migration adds one (e.g. a `gltf_storage_key`), this function's `input` type
 * already has a slot for it (`gltfAssetUrl`) and its resolution order (3D > flat-2d)
 * is decided here, in ONE place, so no caller needs to re-implement "prefer 3D when
 * available, else fall back to the existing PNG renderer" (spec Step 10's fallback
 * requirement) themselves.
 *
 * DELIBERATELY NOT WIRED INTO THE RENDER LOOP YET: every branch besides "flat-2d"
 * would be dead code with a real 3D renderer to call (spec Step 4's own "do not
 * over-engineer"). useLiveArSession.ts continues calling asset-cache.ts/renderer.ts
 * directly, unchanged. A future milestone with a real 3D asset in hand wires this
 * resolver in at that point, branching on its `.type`.
 */
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";

export type JewelleryRepresentationType = "flat-2d" | "layered-2.5d" | "gltf-3d";

/** Everything about one loaded jewellery item that COULD inform which representation
 * to use. Only `flatAsset` is ever populated today -- the other two fields exist so
 * this type doesn't need to change shape when the catalogue eventually gains one of
 * them; they are typed as always `null`/`undefined` right now, never fabricated. */
export interface JewelleryRepresentationInput {
  flatAsset: { image: HTMLImageElement; geometry: JewelleryAssetGeometry } | null;
  /** Not exposed by the catalogue schema today (no column exists) -- see this
   * module's file docstring. Always null/undefined until a real migration adds one. */
  gltfAssetUrl?: string | null;
  /** Same status as `gltfAssetUrl` -- no layered/multi-view asset field exists yet. */
  layeredAssetUrls?: string[] | null;
}

export interface JewelleryRepresentation {
  type: JewelleryRepresentationType;
  flatAsset: { image: HTMLImageElement; geometry: JewelleryAssetGeometry } | null;
  gltfAssetUrl: string | null;
  layeredAssetUrls: string[] | null;
}

/** Resolution order: gltf-3d > layered-2.5d > flat-2d -- richer representations win
 * when present (spec Step 10's "3D asset available? YES -> use 3D, NO -> use current
 * 2D/2.5D renderer"), never the reverse. Pure -- safe to call once per loaded item,
 * same discipline as jewellery-attachment.ts's resolveNecklaceAttachmentModel. */
export function resolveJewelleryRepresentation(input: JewelleryRepresentationInput): JewelleryRepresentation {
  const gltfAssetUrl = input.gltfAssetUrl ?? null;
  const layeredAssetUrls = input.layeredAssetUrls ?? null;

  if (gltfAssetUrl) {
    return { type: "gltf-3d", flatAsset: input.flatAsset, gltfAssetUrl, layeredAssetUrls };
  }
  if (layeredAssetUrls && layeredAssetUrls.length > 0) {
    return { type: "layered-2.5d", flatAsset: input.flatAsset, gltfAssetUrl: null, layeredAssetUrls };
  }
  return { type: "flat-2d", flatAsset: input.flatAsset, gltfAssetUrl: null, layeredAssetUrls: null };
}
