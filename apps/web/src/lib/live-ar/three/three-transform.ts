/**
 * M6.8 3D rendering foundation — pure transform mathematics (spec Step 6/7/10). No
 * WebGL, no rendering — this module produces plain numbers/Three.js math objects
 * (Vector3/Quaternion/Box3, which are pure CPU classes, not GPU resources) from the
 * EXISTING 2D pipeline's already-validated output (geometry.ts's `AnchorResult`/
 * `ScaleResult`/`RotationResult`), so it is fully unit-testable without a browser.
 *
 * WHY DERIVE 3D DEPTH FROM THE EXISTING 2D SCALE, NOT AN INDEPENDENT 3D CALIBRATION:
 * this pipeline has no real camera intrinsics (no measured focal length) and no depth
 * sensor -- there is no independently "correct" 3D distance to place the jewellery
 * at. Rather than inventing one, `computeVirtualDepthMm` picks whichever depth makes
 * the 3D mesh project to EXACTLY the same on-screen width the existing (already
 * real-device-verified across M6.1-M6.6) 2D pipeline already computed
 * (`ScaleResult.targetWidthPx`). This guarantees the 3D path never regresses the
 * already-validated placement/size, for ANY assumed FOV -- see three-types.ts's file
 * docstring for the full coordinate-convention account.
 */
import * as THREE from "three";

import { NECKLACE_3D_YAW_SENSITIVITY_DEGREES } from "@/lib/live-ar/constants";
import type { ThreeCameraConfig, ThreeJewelleryTransform } from "@/lib/live-ar/three/three-types";
import type { PixelPoint, RotationResult, ScaleResult } from "@/lib/live-ar/types";

/** The camera distance (mm, along -Z) at which a `physicalWidthMm`-wide object
 * projects to exactly `targetWidthPx` screen pixels, for the given viewport height and
 * vertical FOV. See this module's file docstring for the full derivation and why the
 * FOV choice doesn't bias the result. Returns `DEFAULT_FAR_MM / 2` (a safe, arbitrary,
 * clearly-in-frustum fallback -- never 0/NaN/Infinity) for degenerate inputs
 * (`targetWidthPx <= 0`, non-finite physical width, or a >=180 degree FOV). */
export function computeVirtualDepthMm(
  physicalWidthMm: number,
  targetWidthPx: number,
  viewportHeightPx: number,
  verticalFovDegrees: number
): number {
  // A >=180deg FOV has no real "half-angle" (tan approaches, but never exactly
  // reaches, a huge finite value in floating point -- never Infinity/NaN -- so this
  // check is explicit rather than relying on tanHalfFov's magnitude alone).
  if (!(verticalFovDegrees > 0) || verticalFovDegrees >= 180) return 500;
  const halfFovRadians = (verticalFovDegrees * Math.PI) / 360;
  const tanHalfFov = Math.tan(halfFovRadians);
  if (!(targetWidthPx > 0) || !(physicalWidthMm > 0) || !(tanHalfFov > 0) || !Number.isFinite(physicalWidthMm)) {
    return 500; // arbitrary, safely-in-frustum fallback -- see doc comment above
  }
  return (physicalWidthMm * viewportHeightPx) / (2 * targetWidthPx * tanHalfFov);
}

/** Standard perspective unprojection at a fixed depth: maps a canvas pixel coordinate
 * (the SAME pixel space `LiveTransform.anchorPx` already uses) to a 3D world point at
 * `depthMm` in front of the camera. Camera looks down -Z (three-types.ts's convention)
 * so the returned `z` is always `-depthMm`. */
export function unprojectScreenPointAtDepth(
  screenPx: PixelPoint,
  viewportWidthPx: number,
  viewportHeightPx: number,
  depthMm: number,
  config: ThreeCameraConfig
): { x: number; y: number; z: number } {
  const ndcX = viewportWidthPx > 0 ? (screenPx.x / viewportWidthPx) * 2 - 1 : 0;
  const ndcY = viewportHeightPx > 0 ? 1 - (screenPx.y / viewportHeightPx) * 2 : 0;
  const halfFovRadians = (config.verticalFovDegrees * Math.PI) / 360;
  const halfHeightAtDepth = depthMm * Math.tan(halfFovRadians);
  const halfWidthAtDepth = halfHeightAtDepth * config.aspect;
  return { x: ndcX * halfWidthAtDepth, y: ndcY * halfHeightAtDepth, z: -depthMm };
}

/** Composes the mesh's world rotation from the SAME two real signals the 2D pipeline
 * already has (roll from shoulder-tilt, geometry.ts's computeNecklaceRotation) plus a
 * yaw angle (documented as an approximation of head yaw -- see
 * NECKLACE_3D_YAW_SENSITIVITY_DEGREES's own doc comment). Order: yaw (Y) applied
 * before roll (Z) -- Three.js's own "YXZ" Euler order, pitch fixed at 0 (spec Step 10:
 * "where current landmarks are insufficient, document the limitation rather than
 * inventing values" -- this pipeline has no real pitch estimate anywhere, so it is
 * NEVER fabricated, always exactly 0 until a real signal exists). */
export function composeJewelleryQuaternion(yawRadians: number, rollRadians: number): [number, number, number, number] {
  const euler = new THREE.Euler(0, yawRadians, rollRadians, "YXZ");
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

/** Converts geometry.ts's `estimateHeadYawAsymmetry` proxy into a yaw angle in
 * radians, for `composeJewelleryQuaternion` above. `null` (no face tracked) maps to 0
 * radians -- the same straight-on fallback the 2D pipeline uses. */
export function yawAsymmetryToRadians(yawAsymmetry: number | null): number {
  if (yawAsymmetry === null) return 0;
  const clamped = Math.max(-1, Math.min(1, yawAsymmetry));
  return (clamped * NECKLACE_3D_YAW_SENSITIVITY_DEGREES * Math.PI) / 180;
}

/** Uniform scale factor to apply to a loaded mesh so its AUTHORED bounding-box width
 * matches the catalogue's real `physical_width_mm` -- reusing the existing physical
 * dimension rather than trusting whatever arbitrary scale the 3D artist happened to
 * export at (spec Step 5: "reuse existing physical dimensions"). Falls back to 1
 * (use the mesh exactly as authored) when either input is missing/non-positive --
 * never divides by zero or fabricates a dimension that isn't there. */
export function computeMeshScaleFactor(physicalWidthMm: number | null, boundingBoxWidthMm: number): number {
  if (physicalWidthMm === null || !(physicalWidthMm > 0) || !(boundingBoxWidthMm > 0)) return 1;
  return physicalWidthMm / boundingBoxWidthMm;
}

/** The single entry point the (not-yet-written) render loop would call once a real
 * asset exists: turns the EXISTING 2D anchor/scale/rotation (unchanged, still the
 * source of truth for "where" and "how big") plus a yaw signal into the full 3D
 * transform a mesh's `.position`/`.quaternion`/`.scale` can be set from directly.
 * Returns `null` exactly when the 2D pipeline itself failed (mirrors
 * `buildLiveTransform`'s own "callers should treat a failed input the same as a lost
 * tracking frame" convention in geometry.ts) -- never fabricates a transform from
 * partial data. */
export function computeThreeJewelleryTransform(
  anchorPx: PixelPoint,
  scale: ScaleResult,
  rotation: RotationResult,
  yawAsymmetry: number | null,
  physicalWidthMm: number,
  boundingBoxWidthMm: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  cameraConfig: ThreeCameraConfig
): ThreeJewelleryTransform | null {
  if (!scale.success || !rotation.success || scale.targetWidthPx === null) return null;

  const depthMm = computeVirtualDepthMm(physicalWidthMm, scale.targetWidthPx, viewportHeightPx, cameraConfig.verticalFovDegrees);
  const positionMm = unprojectScreenPointAtDepth(anchorPx, viewportWidthPx, viewportHeightPx, depthMm, cameraConfig);
  const rollRadians = (rotation.rotationDegrees * Math.PI) / 180;
  const yawRadians = yawAsymmetryToRadians(yawAsymmetry);

  return {
    positionMm,
    quaternion: composeJewelleryQuaternion(yawRadians, rollRadians),
    scale: computeMeshScaleFactor(physicalWidthMm, boundingBoxWidthMm),
  };
}

/** Projects a mesh's world-space bounding box (spec Step 15's "isolated transparent
 * buffer" needs to know WHERE on screen the mesh actually landed, the same role
 * `computeTransformedBoundingBox` plays for the 2D pipeline's occlusion scoping) into
 * canvas pixel space: [left, top, right, bottom]. Pure CPU math (`Vector3.project`) --
 * no WebGL context required, safe to unit-test directly against a real
 * `THREE.PerspectiveCamera`. Caller must have already called
 * `camera.updateProjectionMatrix()` / positioned the camera and the object. */
export function projectWorldBoundingBoxToScreen(
  box: THREE.Box3,
  camera: THREE.Camera,
  viewportWidthPx: number,
  viewportHeightPx: number
): [number, number, number, number] {
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const xsPx: number[] = [];
  const ysPx: number[] = [];
  for (const corner of corners) {
    const ndc = corner.clone().project(camera);
    xsPx.push(((ndc.x + 1) / 2) * viewportWidthPx);
    ysPx.push(((1 - ndc.y) / 2) * viewportHeightPx);
  }
  return [Math.min(...xsPx), Math.min(...ysPx), Math.max(...xsPx), Math.max(...ysPx)];
}
