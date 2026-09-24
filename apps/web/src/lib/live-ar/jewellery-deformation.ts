/**
 * Jewellery curvature (M6.5 spec Step 4/5): a controlled, testable approximation of
 * "the necklace follows the neck instead of hanging as a flat rectangle."
 *
 * ALGORITHM CHOSEN, AND WHY (spec Step 5 -- "evaluate which approach fits the current
 * asset pipeline and browser performance requirements... prefer the simplest approach
 * that produces measurable improvement"):
 *
 * Considered: (A) mesh-based 2D deformation, (B) piecewise-affine strips, (C) full
 * Canvas mesh warp, (D) WebGL vertex deformation, (E) cylindrical projection.
 *
 * Chosen: (B), a simplified piecewise-RIGID variant -- the source sprite is sliced into
 * N vertical strips; each strip is drawn with its own rigid vertical (local Y-axis)
 * offset, forming a shallow downward bow across the piece's width. No per-strip
 * scaling/shearing/resampling is applied (deliberately -- spec Step 11: "do NOT use...
 * colour tricks intended to hide bad alignment" / no fake stretch). This:
 *  - fits the EXISTING Canvas 2D renderer exactly (renderer.ts's drawJewelleryOverlay
 *    already does one `ctx.drawImage` inside a translate/rotate/scale block; this adds
 *    more `drawImage` calls inside the SAME block, not a new rendering technology),
 *  - needs no WebGL/WebGPU (ruled out for this milestone -- see the M6.5 request and
 *    renderer.ts's own file docstring on why Canvas 2D was chosen for this pipeline),
 *  - is O(stripCount) extra `drawImage` calls per frame per neck item (stripCount is
 *    small, see constants.ts) -- cheap next to this pipeline's already-measured
 *    segmentation/occlusion costs (docs/live-ar-realism-verification.md),
 *  - is a PURE function of the asset's own geometry + curvature params, not the
 *    per-frame transform -- so the strip plan is computed ONCE per loaded asset (see
 *    useLiveArSession.ts) and reused unchanged every frame, never recomputed 30-60x/sec.
 *
 * NOT chosen (Step 16 "explicitly report... what requires 2.5D deformation / 3D
 * models"): true mesh/cylindrical warping (fits the jewellery convincingly around the
 * neck's actual depth, front-to-back) needs per-pixel resampling or a real mesh, which
 * this rigid strip-shift approach does not attempt -- it only bows the TOP contour where
 * the piece meets the neck, which is the visually dominant cue for "attached" vs.
 * "pasted on", not a full 3D wrap. Documented limitation, not claimed as solved.
 */
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";
import type { NeckCurvatureParams } from "@/lib/live-ar/jewellery-attachment";

/** One vertical slice of the source sprite. `sourceX`/`sourceWidth`/`sourceHeight` are
 * in the asset's OWN pixel space (full image, not just the alpha bbox -- see this
 * module's docstring). `dropPx` is the additional LOCAL Y-axis offset (same units as
 * `LiveTransform.sourceAnchorPx`, i.e. pre-`ctx.scale` asset-space pixels) to add on top
 * of the ordinary `-sourceAnchorPx.y` offset every strip already gets -- see
 * renderer.ts's drawJewelleryOverlay for exactly how this is consumed. */
export interface JewelleryStrip {
  sourceX: number;
  sourceWidth: number;
  sourceHeight: number;
  dropPx: number;
}

/** Parabolic drop profile: 0 at the alpha bbox's left/right edges, `maxDropPx` at its
 * horizontal center -- clamped to the edge value outside the bbox (padding regions),
 * so degenerate or padded assets never see the profile flip sign or diverge. */
function dropForFraction(fraction01: number, maxDropPx: number): number {
  const t = Math.min(1, Math.max(0, fraction01));
  return maxDropPx * (1 - (2 * t - 1) ** 2);
}

/** Computes the strip plan for a loaded asset + resolved curvature params. Pure and
 * independent of the per-frame `LiveTransform` (translate/rotate/scale/mirror never
 * change which strips exist or their drop amounts -- only where the WHOLE plan is
 * subsequently drawn on screen, handled by renderer.ts) -- callers should compute this
 * once per (asset, curvature) pair and reuse it every frame (see useLiveArSession.ts).
 *
 * Returns a single, zero-drop strip covering the whole image whenever curvature is
 * disabled (`maxDropFraction <= 0` or `stripCount <= 1`) or the asset's alpha bbox is
 * degenerate (zero width/height) -- callers do not need to special-case "no curvature"
 * separately from "one flat strip"; both draw identically to the pre-M6.5 single
 * `drawImage` call. */
export function computeJewelleryStrips(assetGeometry: JewelleryAssetGeometry, curvature: NeckCurvatureParams): JewelleryStrip[] {
  const { widthPx, heightPx, alphaBbox } = assetGeometry;
  const stripCount = Math.max(1, Math.floor(curvature.stripCount));
  const [bboxLeft, , bboxRight] = alphaBbox;
  const bboxWidthPx = bboxRight - bboxLeft;

  if (curvature.maxDropFraction <= 0 || stripCount <= 1 || bboxWidthPx <= 0 || widthPx <= 0 || heightPx <= 0) {
    return [{ sourceX: 0, sourceWidth: widthPx, sourceHeight: heightPx, dropPx: 0 }];
  }

  const maxDropPx = curvature.maxDropFraction * bboxWidthPx;
  const stripWidthPx = widthPx / stripCount;
  const strips: JewelleryStrip[] = [];
  for (let i = 0; i < stripCount; i++) {
    const sourceX = i * stripWidthPx;
    // Last strip absorbs any rounding remainder so strips always tile the image
    // exactly, with no gap or overlap.
    const sourceWidth = i === stripCount - 1 ? widthPx - sourceX : stripWidthPx;
    const centerX = sourceX + sourceWidth / 2;
    const fraction01 = (centerX - bboxLeft) / bboxWidthPx;
    strips.push({ sourceX, sourceWidth, sourceHeight: heightPx, dropPx: dropForFraction(fraction01, maxDropPx) });
  }
  return strips;
}
