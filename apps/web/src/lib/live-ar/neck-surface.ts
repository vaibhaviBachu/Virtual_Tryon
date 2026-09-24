/**
 * Neck surface debug model (M6.6 Step 2/11): a coordinate system representing
 * LEFT NECK / FRONT NECK / RIGHT NECK, for the "Wear Geometry Debug" visualization --
 * NOT a new placement mechanism (jewellery coordinates are still mapped via
 * neck-reference.ts + jewellery-deformation.ts/neck-projection.ts exactly as before;
 * this module only visualizes that same, already-computed reference frame).
 *
 * Deliberately derived ENTIRELY from `NeckReferenceFrame` fields that already exist
 * (`centerPx`, `widthPx`) rather than recomputing anything from landmarks itself --
 * this project's repeated lesson (M6.4's bounding-box bug, M6.5's alpha-debug
 * refactor) is that a debug visualization built from a SEPARATE approximate
 * computation can silently drift from what's actually used; this module has no
 * separate computation to drift from.
 */
import type { NeckReferenceFrame, PixelPoint } from "@/lib/live-ar/types";

export interface NeckSurfaceDebugPoints {
  centerPx: PixelPoint;
  leftBoundaryPx: PixelPoint;
  rightBoundaryPx: PixelPoint;
  radiusPx: number;
}

/** Returns null when the neck reference frame has no width estimate at all (the
 * `shoulder_offset_fallback_no_face` method -- see neck-reference.ts) -- the debug
 * overlay simply omits the neck-width markers that frame, rather than guessing a width
 * that was never actually computed. */
export function computeNeckSurfaceDebugPoints(neck: NeckReferenceFrame): NeckSurfaceDebugPoints | null {
  if (neck.widthPx === null || neck.widthPx <= 0) return null;
  const radiusPx = neck.widthPx / 2;
  return {
    centerPx: neck.centerPx,
    leftBoundaryPx: { x: neck.centerPx.x - radiusPx, y: neck.attachmentPx.y },
    rightBoundaryPx: { x: neck.centerPx.x + radiusPx, y: neck.attachmentPx.y },
    radiusPx,
  };
}
