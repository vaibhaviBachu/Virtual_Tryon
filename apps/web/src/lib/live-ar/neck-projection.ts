/**
 * Neck projection (M6.6, "PHYSICAL NECK CONTACT, DEPTH & WEARING BEHAVIOR"): the shared
 * elliptical/cylindrical projection math BOTH `jewellery-deformation.ts` (what actually
 * gets drawn) and `neck-surface.ts` (the debug visualization of the SAME model) consume
 * -- one source of truth, so the debug overlay can never show a neck surface that
 * differs from what the jewellery is actually being projected onto (the exact
 * duplicated-math failure class M6.4's bounding-box bug and M6.5's alpha-debug
 * refactor both had to correct after the fact -- avoided here by construction).
 *
 * THE MODEL (Step 3's "lightweight cylindrical/elliptical projection... simplest
 * approach that produces measurable improvement... do NOT automatically choose
 * WebGL... first determine whether Canvas 2D can provide sufficient quality"):
 *
 * The neck's cross-section (viewed from the front) is approximated as a semi-ellipse.
 * A jewellery item's contact curve is modeled as wrapping a `curvatureHalfAngleRadians`
 * arc of that ellipse, centered on a CONTACT PEAK -- the point on the arc closest to
 * camera. At yaw=0 the peak sits at the sprite's horizontal center (M6.5's exact
 * behavior). Head yaw (geometry.ts's `estimateHeadYawAsymmetry`) shifts WHERE that peak
 * sits within the sprite (Step 4's "contact curve must move with the neck... body
 * reference -> neck surface -> jewellery contact curve", Step 8's "apparent width
 * changes appropriately with viewpoint") via two effects, both derived from the SAME
 * angle, never independently tuned:
 *   1. the peak's horizontal position shifts toward the side turned toward the camera
 *      (`computeContactPeakFraction`),
 *   2. the whole sprite is foreshortened (cosine of the effective yaw-adjusted angle)
 *      as if viewed at an angle rather than dead-on (`computeHorizontalForeshorten`).
 *
 * HONEST LIMITATION (Step 9): this is a 2D projection of an assumed-elliptical
 * cross-section, driven by a 2D landmark-asymmetry yaw PROXY, not a calibrated 3D head
 * pose or a true per-vertex 3D neck mesh. It cannot show the jewellery's true back
 * side, cannot relight per angle, and is not metrically accurate at extreme angles (see
 * NECKLACE_MIN_HORIZONTAL_FORESHORTEN's own doc comment for the deliberate floor this
 * implies). It is a real, testable, angle-RESPONSIVE geometric approximation -- a
 * genuine improvement over M6.5's angle-BLIND flat parabola -- not a claim of
 * photorealistic 3D wearing.
 */
import { NECKLACE_MIN_HORIZONTAL_FORESHORTEN, NECKLACE_YAW_SHIFT_STRENGTH } from "@/lib/live-ar/constants";

/** Where, along [0, 1] across the jewellery's own measured width, the contact curve's
 * peak (closest-to-camera point) sits. 0.5 (dead center) at yaw=0 -- byte-for-byte
 * M6.5's assumption. Clamped well inside [0, 1] (never at the true edges) so the
 * piecewise drop/foreshorten profiles below always have a well-defined near side and
 * far side, even at extreme measured yaw. */
export function computeContactPeakFraction(yawAsymmetry: number): number {
  const clampedYaw = Math.max(-1, Math.min(1, yawAsymmetry));
  const shift = (clampedYaw * NECKLACE_YAW_SHIFT_STRENGTH) / 2;
  return Math.min(0.8, Math.max(0.2, 0.5 + shift));
}

/** Normalized distance from the contact peak, in [0, 1]: 0 exactly at the peak, 1 at
 * whichever bounding edge (0 or 1) is nearer to `fraction01` given where the peak
 * currently sits. This single quantity is reused for BOTH the vertical "drop" (how far
 * this part of the jewellery recedes below the contact point, following the neck's
 * curve) and, for the debug surface model, as a depth proxy (Step 6: "does not need to
 * be metrically accurate... relative ordering") -- distance from the body contact point
 * doubling as a depth stand-in is a documented simplification, not a real z-buffer. */
export function computeContactDistanceFraction(fraction01: number, peakFraction: number): number {
  const t = Math.min(1, Math.max(0, fraction01));
  if (t <= peakFraction) {
    return peakFraction <= 0 ? 0 : (peakFraction - t) / peakFraction;
  }
  const farSpan = 1 - peakFraction;
  return farSpan <= 0 ? 0 : (t - peakFraction) / farSpan;
}

/** The whole-sprite horizontal scale factor modeling "viewed at an angle, so narrower
 * than dead-on" (Step 8) -- a single scalar per frame (not per-strip: see this module's
 * file docstring on why a per-strip destination-width change was deliberately avoided),
 * applied on top of the ordinary scale/rotation transform. 1.0 at yaw=0 (M6.5's exact
 * width). Floored at NECKLACE_MIN_HORIZONTAL_FORESHORTEN -- see that constant's doc
 * comment for why. */
export function computeHorizontalForeshorten(yawAsymmetry: number, curvatureHalfAngleRadians: number): number {
  const clampedYaw = Math.max(-1, Math.min(1, yawAsymmetry));
  const effectiveAngle = clampedYaw * NECKLACE_YAW_SHIFT_STRENGTH * curvatureHalfAngleRadians;
  return Math.max(NECKLACE_MIN_HORIZONTAL_FORESHORTEN, Math.cos(effectiveAngle));
}
