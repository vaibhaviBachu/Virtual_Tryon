/**
 * Jewellery curvature (M6.5 spec Step 4/5, extended by M6.6 spec Step 3/4/8): a
 * controlled, testable approximation of "the necklace follows the neck instead of
 * hanging as a flat rectangle," now RESPONSIVE to head yaw via neck-projection.ts's
 * shared elliptical-projection math (see that module's file docstring for the full
 * model -- this file only turns the projection into a Canvas-2D strip plan).
 *
 * ALGORITHM CHOSEN, AND WHY (M6.5 Step 5 / M6.6 Step 3 -- "evaluate which approach fits
 * the current asset pipeline and browser performance requirements... prefer the
 * simplest approach that produces measurable improvement... do NOT automatically
 * choose WebGL"):
 *
 * Considered: (A) mesh-based 2D deformation, (B) piecewise-affine strips, (C) full
 * Canvas mesh warp, (D) WebGL vertex deformation, (E) cylindrical/elliptical
 * projection. **Chosen: (B) + (E) combined** -- the source sprite is sliced into N
 * vertical strips, each drawn with its own rigid vertical (local Y-axis) offset
 * DERIVED from an elliptical neck cross-section projection (neck-projection.ts), plus a
 * single whole-sprite horizontal foreshorten factor for the same projection's viewing-
 * angle effect. No per-strip scaling/shearing/resampling (M6.5 Step 11 / M6.6 Step 7:
 * no fake stretch/shadow tricks -- geometry first). This:
 *  - fits the EXISTING Canvas 2D renderer exactly (renderer.ts's drawJewelleryOverlay
 *    already does one `ctx.drawImage` inside a translate/rotate/scale block; this adds
 *    more `drawImage` calls plus one extra scale factor inside the SAME block, not a
 *    new rendering technology),
 *  - needs no WebGL/WebGPU,
 *  - is O(stripCount) extra `drawImage` calls per frame per neck item (stripCount is
 *    small, see constants.ts) -- cheap next to this pipeline's already-measured
 *    segmentation/occlusion costs (docs/live-ar-realism-verification.md),
 *  - unlike M6.5, this MUST be recomputed every frame (not once per asset load): head
 *    yaw changes continuously, and the whole point of M6.6 is that the strip plan
 *    responds to it. Still cheap -- `stripCount` (20) iterations of plain arithmetic,
 *    not per-pixel work; see useLiveArSession.ts for where this now runs (moved out of
 *    the once-per-asset-load cache M6.5 used).
 *
 * NOT chosen (M6.6 Step 9 "explicitly document... what requires 3D models"): true
 * mesh/cylindrical warping with per-pixel resampling, or a real 3D mesh -- this
 * rigid-strip-plus-whole-sprite-foreshorten approach approximates a cylinder's
 * contact-curve and apparent-width response to viewing angle, but never shows true
 * back-side geometry, per-angle relighting, or physically accurate thickness. See
 * neck-projection.ts's file docstring for the full honest-limitation account.
 */
import { computeContactDistanceFraction, computeContactPeakFraction, computeHorizontalForeshorten } from "@/lib/live-ar/neck-projection";
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

/** The strip plan plus the single whole-sprite scale factor the SAME projection also
 * produces (neck-projection.ts's computeHorizontalForeshorten) -- both consumed by
 * renderer.ts's drawJewelleryOverlay/drawOccludedJewelleryOverlay. */
export interface JewelleryDeformationPlan {
  strips: JewelleryStrip[];
  horizontalForeshorten: number;
  /** Where (as a [0,1] fraction across the asset's own alpha-bbox width) the contact
   * curve's peak currently sits -- exposed for neck-surface.ts's debug visualization to
   * draw the SAME point the strips were actually computed from, never a separate
   * approximation. */
  contactPeakFraction: number;
}

/** Computes the strip plan + whole-sprite foreshorten for a loaded asset + resolved
 * curvature params + the current frame's estimated head-yaw asymmetry (geometry.ts's
 * `estimateHeadYawAsymmetry`, or 0 for the M6.5-equivalent straight-on assumption when
 * no face is tracked). MUST be called every frame (see this module's file docstring --
 * unlike M6.5, this is no longer a once-per-asset-load cacheable result, since yaw
 * changes continuously).
 *
 * Returns a single, zero-drop strip covering the whole image (and `horizontalForeshorten:
 * 1`) whenever curvature is disabled (`maxDropFraction <= 0` or `stripCount <= 1`) or
 * the asset's alpha bbox is degenerate (zero width/height) -- callers do not need to
 * special-case "no curvature" separately from "one flat strip"; both draw identically
 * to the pre-M6.5 single `drawImage` call. */
export function computeJewelleryStrips(
  assetGeometry: JewelleryAssetGeometry,
  curvature: NeckCurvatureParams,
  yawAsymmetry: number
): JewelleryDeformationPlan {
  const { widthPx, heightPx, alphaBbox } = assetGeometry;
  const stripCount = Math.max(1, Math.floor(curvature.stripCount));
  const [bboxLeft, , bboxRight] = alphaBbox;
  const bboxWidthPx = bboxRight - bboxLeft;

  if (curvature.maxDropFraction <= 0 || stripCount <= 1 || bboxWidthPx <= 0 || widthPx <= 0 || heightPx <= 0) {
    return {
      strips: [{ sourceX: 0, sourceWidth: widthPx, sourceHeight: heightPx, dropPx: 0 }],
      horizontalForeshorten: 1,
      contactPeakFraction: 0.5,
    };
  }

  const peakFraction = computeContactPeakFraction(yawAsymmetry);
  const horizontalForeshorten = computeHorizontalForeshorten(yawAsymmetry, curvature.curvatureHalfAngleRadians);
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
    const distanceFraction = computeContactDistanceFraction(fraction01, peakFraction);
    const dropPx = maxDropPx * (1 - distanceFraction ** 2);
    strips.push({ sourceX, sourceWidth, sourceHeight: heightPx, dropPx: Math.max(0, dropPx) });
  }
  return { strips, horizontalForeshorten, contactPeakFraction: peakFraction };
}
