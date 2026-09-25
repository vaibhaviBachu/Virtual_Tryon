/**
 * Phase F — real 3D head pose, extracted from MediaPipe FaceLandmarker's own
 * `facialTransformationMatrixes` output (enabled in tracking.ts via
 * `outputFacialTransformationMatrixes: true`, Step 4's own explicit ask: "the
 * repository research already identified that outputFacialTransformationMatrixes
 * exists but was not wired in... determine whether it can be used here").
 *
 * WHY THIS EXISTS: `estimateHeadYawAsymmetry` (geometry.ts, M6.6) is an explicitly
 * documented 2D landmark-asymmetry PROXY -- it has no pitch at all (every consumer
 * before this phase hardcoded pitch to 0), and its yaw is a heuristic, not a
 * calibrated angle. MediaPipe's own transformation matrix is real: it is the actual
 * rotation+translation MediaPipe computed to fit its canonical 3D face model onto
 * this frame's detected landmarks -- the SAME matrix the MediaPipe documentation
 * describes as intended "so that users can apply face effects on the detected
 * landmarks" (i.e., use it as a model matrix for a 3D object -- exactly this
 * pipeline's own use case).
 *
 * WHAT THIS MODULE DOES NOT CLAIM: the matrix's TRANSLATION component is in
 * MediaPipe's own canonical-face-model metric space, not this project's own
 * mm-camera-space convention (three-types.ts) -- using it directly for POSITION
 * would silently introduce a second, uncalibrated coordinate system alongside the
 * existing, already-validated 2D-anchor-derived position. This module therefore
 * extracts ONLY the rotation (as a quaternion, decomposed into yaw/pitch/roll for
 * human-readable debug display) and leaves position exactly as the existing
 * pipeline already computes it (three-live-bridge.ts).
 *
 * HONEST, UNVERIFIED ASSUMPTION (no real camera/device exists in this environment
 * to confirm it -- flagged exactly as prominently as every other real-device-only
 * gap in this project's history): `Matrix.data` is assumed to be a COLUMN-MAJOR
 * flattened 4x4 (the standard WebGL/OpenGL layout, and the same layout
 * `THREE.Matrix4.elements`/`.fromArray()` use) -- this is the conventional layout
 * for a matrix explicitly documented as usable to "apply face effects" (i.e., as a
 * GL/Three.js-style model matrix), but it has not been empirically confirmed
 * against a real device. If real-person testing (docs/
 * true-body-surface-jewellery-attachment.md §14) shows yaw/pitch/roll are inverted
 * or swapped, check this assumption FIRST -- it is a one-line fix
 * (`.transpose()` before decomposing, or swapping which axis reads as yaw vs pitch).
 */
import * as THREE from "three";

export interface DecomposedHeadPose {
  quaternion: [number, number, number, number];
  yawRadians: number;
  pitchRadians: number;
  rollRadians: number;
}

/** `data` must be a flattened 4x4 matrix (16 numbers), matching MediaPipe
 * Tasks-Vision's own `Matrix.data` shape (`Matrix.rows === 4 && Matrix.columns === 4`
 * for a facial transformation matrix). Returns `null` for any input that isn't
 * exactly 16 finite numbers -- never a fabricated pose from malformed data. */
export function decomposeFacialTransformMatrix(data: number[] | null): DecomposedHeadPose | null {
  if (!data || data.length !== 16 || !data.every((n) => Number.isFinite(n))) return null;

  const matrix = new THREE.Matrix4().fromArray(data);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  // A degenerate/zero-scale matrix (shouldn't happen for a real detection, but never
  // trust external data blindly) produces a meaningless quaternion -- reject it.
  if (!Number.isFinite(quaternion.x) || (scale.x === 0 && scale.y === 0 && scale.z === 0)) return null;

  // "YXZ" order (yaw, then pitch, then roll) -- the SAME Euler order
  // composeJewelleryQuaternion/composeJewelleryQuaternionFromEuler (three-transform.ts)
  // already use, so a debug readout of these three numbers means the same thing as
  // the angles actually fed into the render transform.
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");

  return {
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    yawRadians: euler.y,
    pitchRadians: euler.x,
    rollRadians: euler.z,
  };
}
