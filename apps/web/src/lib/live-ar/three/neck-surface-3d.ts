/**
 * Phase G — a real, parametric 3D neck surface (an elliptical-cylinder cross-
 * section), built after a real-person webcam test showed Phase F's approach
 * (rotate an already-curved rigid mesh by a real 3D orientation, with no explicit
 * surface model at all) still read as "floating in front of," not "worn." See
 * docs/true-3d-neck-attachment.md §1-2 for the full failure analysis.
 *
 * WHAT IS REAL vs ESTIMATED, STATED EXPLICITLY (Step 6's own requirement):
 *
 * - `centerMm`/`axisUp`/`axisRight`/`axisForward`: REAL. `axisUp/Right/Forward` are
 *   exactly Phase F's own already-real orientation (real shoulder roll; real head
 *   yaw/pitch from MediaPipe's facial transformation matrix, or its documented 2D
 *   proxy fallback) -- this module adds no new orientation source, it only exposes
 *   that same orientation AS a local coordinate frame's axes. `centerMm` is derived
 *   from the EXISTING, already-real 2D-anchor-unprojected position (unchanged from
 *   Phase E/F) -- see `computeNeckSurfaceFrame`'s own doc comment for why that
 *   tracked point is treated as the ellipse's FRONT surface point, not its center.
 * - `radiusXMm`: REAL-ISH. Derived from `neck-reference.ts`'s own EXISTING
 *   `widthPx` estimate (already established, unchanged: 80% of face width,
 *   `NECK_WIDTH_FRACTION_OF_FACE_WIDTH` -- not a new assumption introduced here),
 *   converted to mm using the SAME px-per-mm calibration already trusted for the
 *   jewellery's own physical scale (`asset.metadata.physicalWidthMm` /
 *   `targetWidthPx` -- no new calibration constant for this conversion step).
 * - `radiusZMm`: **EXPLICITLY ESTIMATED, not measured.** No landmark, matrix, or
 *   calibration anywhere in this pipeline gives a real neck depth (confirmed by
 *   this phase's own audit -- no depth sensor, no stereo/multi-view capture, no
 *   MediaPipe output that measures front-to-back neck thickness). Computed as
 *   `radiusXMm * NECK_DEPTH_TO_WIDTH_RATIO_ESTIMATE`, a documented anthropometric
 *   approximation (adult neck cross-sections are near-elliptical, flattened
 *   front-to-back relative to side-to-side; a ratio in the 0.7-0.85 range is a
 *   commonly-cited approximation for this general body-cross-section shape -- 0.75
 *   is used here as a single, clearly-labeled midpoint estimate, never claimed as
 *   measured). If real testing shows this estimate is materially wrong, the honest
 *   fix is a better measurement source (stereo capture, a depth camera, or a
 *   calibrated multi-view rig) -- not a silently tuned constant. See
 *   docs/true-3d-neck-attachment.md's final report for this exact STOP-CONDITION
 *   admission.
 */
import * as THREE from "three";

import type { SurfaceOrientation } from "@/lib/live-ar/three/body-attachment";
import { composeJewelleryQuaternionFromEuler } from "@/lib/live-ar/three/three-transform";

/** ESTIMATED anthropometric ratio -- see this module's file docstring. Not a
 * measurement; a documented, explicit approximation. */
export const NECK_DEPTH_TO_WIDTH_RATIO_ESTIMATE = 0.75;

export interface NeckSurfaceFrame {
  centerMm: { x: number; y: number; z: number };
  axisUp: { x: number; y: number; z: number };
  axisRight: { x: number; y: number; z: number };
  axisForward: { x: number; y: number; z: number };
  radiusXMm: number;
  /** ESTIMATED -- see file docstring. */
  radiusZMm: number;
  confidence: number;
  method: "elliptical_cylinder_from_tracked_width_and_orientation";
}

export interface NeckSurfacePoint {
  position: { x: number; y: number; z: number };
  /** Outward unit normal -- the REAL analytic ellipse normal (proportional to
   * `(sin(t)/radiusX, cos(t)/radiusZ)`), not simply the radial direction, which is
   * only correct for a circle. */
  normal: { x: number; y: number; z: number };
  tangent: { x: number; y: number; z: number };
}

/** Reuses the SAME px-per-mm calibration already trusted for the jewellery's own
 * physical scale (`deriveScaleResultFromSmoothedTransform`'s `targetWidthPx`
 * divided by the asset's known `physicalWidthMm`) -- never a second, independent
 * calibration. Returns `null` for degenerate inputs, never a divide-by-zero. */
export function derivePxPerMm(targetWidthPx: number | null, physicalWidthMm: number | null): number | null {
  if (targetWidthPx === null || physicalWidthMm === null || !(targetWidthPx > 0) || !(physicalWidthMm > 0)) return null;
  return targetWidthPx / physicalWidthMm;
}

/**
 * `frontSurfacePositionMm` is the EXISTING, already-real attachment point (the 2D
 * anchor unprojected at the depth-matched Z, unchanged from Phase E/F) -- treated
 * as the ellipse's own FRONT SURFACE point (angle=0), not its center. This is a
 * physical claim, not an arbitrary choice: a 2D camera observes the FRONT of a
 * person's neck (the side facing it); it never directly observes the neck's
 * central axis. The ellipse's center is therefore derived by stepping BACKWARD
 * from that observed surface point by `radiusZMm`, along the current forward
 * direction -- not the other way around.
 *
 * Returns `null` when the neck width isn't measurable this frame (no face-based
 * width estimate available -- see `NeckReferenceFrame.widthPx`'s own `null` case)
 * or the px-per-mm calibration is unavailable -- never a fabricated radius.
 */
export function computeNeckSurfaceFrame(
  frontSurfacePositionMm: { x: number; y: number; z: number },
  orientation: SurfaceOrientation,
  neckWidthPx: number | null,
  pxPerMm: number | null,
  confidence: number
): NeckSurfaceFrame | null {
  if (neckWidthPx === null || !(neckWidthPx > 0) || pxPerMm === null || !(pxPerMm > 0)) return null;

  const radiusXMm = neckWidthPx / pxPerMm / 2;
  const radiusZMm = radiusXMm * NECK_DEPTH_TO_WIDTH_RATIO_ESTIMATE;

  const [qx, qy, qz, qw] = composeJewelleryQuaternionFromEuler(orientation.yawRadians, orientation.pitchRadians, orientation.rollRadians);
  const quaternion = new THREE.Quaternion(qx, qy, qz, qw);
  const axisUp = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const axisRight = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const axisForward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

  const centerMm = {
    x: frontSurfacePositionMm.x - axisForward.x * radiusZMm,
    y: frontSurfacePositionMm.y - axisForward.y * radiusZMm,
    z: frontSurfacePositionMm.z - axisForward.z * radiusZMm,
  };

  return {
    centerMm,
    axisUp: { x: axisUp.x, y: axisUp.y, z: axisUp.z },
    axisRight: { x: axisRight.x, y: axisRight.y, z: axisRight.z },
    axisForward: { x: axisForward.x, y: axisForward.y, z: axisForward.z },
    radiusXMm,
    radiusZMm,
    confidence,
    method: "elliptical_cylinder_from_tracked_width_and_orientation",
  };
}

/**
 * The real parametric surface function (Step 7's own `surfacePoint(u,v)`/
 * `surfaceFrame(u,v)` ask, specialized to a cylinder's single circumferential
 * parameter since this model has no independent vertical variation -- a genuine,
 * intentional simplification, not a missing feature: nothing in this pipeline's
 * available tracking varies meaningfully along the neck's own vertical axis).
 * `angleRadians = 0` is the front (facing the camera at yaw=0), increasing toward
 * `axisRight`. Pure math, no rendering dependency, fully unit-testable without
 * WebGL.
 */
export function neckSurfacePointAt(frame: NeckSurfaceFrame, angleRadians: number): NeckSurfacePoint {
  const sin = Math.sin(angleRadians);
  const cos = Math.cos(angleRadians);

  const position = {
    x: frame.centerMm.x + frame.axisRight.x * frame.radiusXMm * sin + frame.axisForward.x * frame.radiusZMm * cos,
    y: frame.centerMm.y + frame.axisRight.y * frame.radiusXMm * sin + frame.axisForward.y * frame.radiusZMm * cos,
    z: frame.centerMm.z + frame.axisRight.z * frame.radiusXMm * sin + frame.axisForward.z * frame.radiusZMm * cos,
  };

  const nRight = sin / frame.radiusXMm;
  const nForward = cos / frame.radiusZMm;
  const normalLen = Math.hypot(nRight, nForward) || 1;
  const normal = {
    x: (frame.axisRight.x * nRight + frame.axisForward.x * nForward) / normalLen,
    y: (frame.axisRight.y * nRight + frame.axisForward.y * nForward) / normalLen,
    z: (frame.axisRight.z * nRight + frame.axisForward.z * nForward) / normalLen,
  };

  const tRight = cos * frame.radiusXMm;
  const tForward = -sin * frame.radiusZMm;
  const tangentLen = Math.hypot(tRight, tForward) || 1;
  const tangent = {
    x: (frame.axisRight.x * tRight + frame.axisForward.x * tForward) / tangentLen,
    y: (frame.axisRight.y * tRight + frame.axisForward.y * tForward) / tangentLen,
    z: (frame.axisRight.z * tRight + frame.axisForward.z * tForward) / tangentLen,
  };

  return { position, normal, tangent };
}
