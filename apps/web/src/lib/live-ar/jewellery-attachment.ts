/**
 * Jewellery attachment model (M6.5, "M6.5 REALISTIC JEWELLERY WEARING / CONTACT
 * RENDERING" spec Step 3): JEWELLERY CATEGORY != JEWELLERY ATTACHMENT MODEL. A choker,
 * a medium necklace, and a long haaram all get placed via the SAME neck reference frame
 * (neck-reference.ts) but should not get the SAME attachment behavior -- a choker sits
 * close/flat against the neck; a haaram's top contour still meets the neck but the
 * piece as a whole hangs much lower.
 *
 * This module resolves, ONCE per loaded asset (never per frame -- same discipline as
 * asset-cache.ts's own geometry computation), which attachment class a given jewellery
 * item belongs to, using only signals that are ACTUALLY available today:
 *  - the item's own catalogue category slug ("haaram" is a distinct catalogue category
 *    from "necklace" -- see LiveArStudio.tsx's haaramCategoryId), and
 *  - the asset's OWN measured alpha-bounding-box aspect ratio (asset-cache.ts already
 *    computes this), to further split "necklace" into choker vs. ordinary necklace.
 *
 * HONEST LIMITATION: the catalogue's `extra_measurements` JSON field could in principle
 * carry an explicit, admin-supplied necklace length/attachment class (see
 * db/models/jewellery.py's docstring), but nothing in this codebase currently populates
 * or reads it (confirmed by grep -- see docs/live-ar-realism-verification.md's M6.5
 * asset audit section). This resolver therefore falls back to a measured heuristic
 * rather than inventing a value that isn't there. If/when that metadata exists, prefer
 * it over this heuristic -- do not silently ignore real admin-supplied data once it does.
 */
import {
  CHOKER_ASPECT_RATIO_THRESHOLD,
  NECKLACE_CURVATURE_HALF_ANGLE_RADIANS,
  NECKLACE_CURVATURE_MAX_DROP_FRACTION,
  NECKLACE_CURVATURE_STRIP_COUNT,
} from "@/lib/live-ar/constants";
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";

export type NecklaceAttachmentClass = "choker" | "necklace" | "haaram";

export interface NeckCurvatureParams {
  /** Fraction of the asset's own measured (alpha-bbox) width -- see
   * neck-projection.ts's computeContactProjection for how this is applied. */
  maxDropFraction: number;
  stripCount: number;
  /** M6.6: half the angle of neck circumference this class's contact curve is modeled
   * as wrapping, in radians -- see constants.ts's NECKLACE_CURVATURE_HALF_ANGLE_RADIANS
   * and neck-projection.ts's file docstring for the elliptical-projection model this
   * feeds. */
  curvatureHalfAngleRadians: number;
}

export interface JewelleryAttachmentModel {
  attachmentClass: NecklaceAttachmentClass;
  curvature: NeckCurvatureParams;
  /** Key into NECKLACE_LENGTH_OFFSET_MULTIPLIER (geometry.ts's existing
   * computeNecklaceAnchor length-adjustment mechanism -- present since Milestone 4/5 but
   * never actually fed a non-null value until this milestone; see that constant's own
   * doc comment). "short" for a choker, "medium" for an ordinary necklace, "long" for a
   * haaram. */
  necklaceLengthKey: string;
}

/** Classifies a "necklace"-category item as a choker or an ordinary necklace, using the
 * asset's OWN measured alpha-bbox aspect ratio -- never the raw image dimensions (which
 * may include transparent padding), matching this codebase's existing "use the alpha
 * footprint, not the raw rectangle" convention (asset-cache.ts, occlusion.ts). Degenerate
 * (zero-width or zero-height) bboxes are classified as an ordinary necklace, the safer
 * (less aggressive curvature) default. */
function classifyNecklaceAspectRatio(assetGeometry: JewelleryAssetGeometry): "choker" | "necklace" {
  const [left, top, right, bottom] = assetGeometry.alphaBbox;
  const widthPx = right - left;
  const heightPx = bottom - top;
  if (widthPx <= 0 || heightPx <= 0) return "necklace";
  return heightPx / widthPx <= CHOKER_ASPECT_RATIO_THRESHOLD ? "choker" : "necklace";
}

/** Resolves the attachment class for a "necklace"-or-"haaram"-category item.
 * `categorySlug` is the item's OWN catalogue category slug (e.g. from
 * `JewelleryResponse.category.slug`) -- `null`/anything other than "haaram" is treated
 * as the "necklace" catalogue category, then further split into choker/necklace by
 * measured aspect ratio. */
export function resolveNecklaceAttachmentClass(
  categorySlug: string | null,
  assetGeometry: JewelleryAssetGeometry
): NecklaceAttachmentClass {
  if (categorySlug === "haaram") return "haaram";
  return classifyNecklaceAspectRatio(assetGeometry);
}

const NECKLACE_LENGTH_KEY_BY_ATTACHMENT_CLASS: Record<NecklaceAttachmentClass, string> = {
  choker: "short",
  necklace: "medium",
  haaram: "long",
};

/** The single entry point the render pipeline uses: resolves everything a "necklace"-
 * category-family item's attachment behavior needs, from data already available once
 * the asset has loaded. Pure -- safe to call once per asset load and cache the result
 * (see useLiveArSession.ts), never needs to be recomputed per frame since neither the
 * category slug nor the asset's own geometry change frame to frame. */
export function resolveNecklaceAttachmentModel(
  categorySlug: string | null,
  assetGeometry: JewelleryAssetGeometry
): JewelleryAttachmentModel {
  const attachmentClass = resolveNecklaceAttachmentClass(categorySlug, assetGeometry);
  return {
    attachmentClass,
    curvature: {
      maxDropFraction: NECKLACE_CURVATURE_MAX_DROP_FRACTION[attachmentClass],
      stripCount: NECKLACE_CURVATURE_STRIP_COUNT,
      curvatureHalfAngleRadians: NECKLACE_CURVATURE_HALF_ANGLE_RADIANS[attachmentClass],
    },
    necklaceLengthKey: NECKLACE_LENGTH_KEY_BY_ATTACHMENT_CLASS[attachmentClass],
  };
}
