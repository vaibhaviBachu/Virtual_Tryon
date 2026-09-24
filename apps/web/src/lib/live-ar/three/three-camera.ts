/**
 * M6.8 3D rendering foundation — the fixed virtual camera (spec Step 8). A thin
 * wrapper: all the actual coordinate-convention decisions live in
 * three-types.ts/three-transform.ts; this module only constructs/updates the
 * `THREE.PerspectiveCamera` object those decisions assume exists.
 */
import * as THREE from "three";

import { DEFAULT_FAR_MM, DEFAULT_NEAR_MM, DEFAULT_VERTICAL_FOV_DEGREES } from "@/lib/live-ar/three/three-types";
import type { ThreeCameraConfig } from "@/lib/live-ar/three/three-types";

/** Builds the config object three-transform.ts's functions take, from the REAL video
 * viewport size (never an assumed/hardcoded aspect ratio) plus the documented default
 * FOV/clip planes (three-types.ts's own doc comment explains why the FOV choice is
 * safe to assume). */
export function buildCameraConfig(viewportWidthPx: number, viewportHeightPx: number): ThreeCameraConfig {
  const aspect = viewportHeightPx > 0 ? viewportWidthPx / viewportHeightPx : 1;
  return { verticalFovDegrees: DEFAULT_VERTICAL_FOV_DEGREES, aspect, nearMm: DEFAULT_NEAR_MM, farMm: DEFAULT_FAR_MM };
}

/** Creates the camera once. Caller owns the returned instance and calls
 * `updateCameraForViewport` on it when the viewport size changes -- never construct a
 * new `PerspectiveCamera` per frame (spec Step 17: "do NOT create new... camera every
 * frame"). */
export function createThreeCamera(config: ThreeCameraConfig): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(config.verticalFovDegrees, config.aspect, config.nearMm, config.farMm);
  // Sits at world origin looking down -Z (three-types.ts's documented convention) --
  // this is PerspectiveCamera's own default pose, made explicit here rather than left
  // implicit, per spec Step 8's "do not leave coordinate assumptions implicit."
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  return camera;
}

/** Call whenever the video viewport's pixel size changes (camera resolution
 * negotiated, window resize) -- mirrors renderer.ts's `ensureCanvasSize` convention of
 * only touching state when the size actually changed. Mutates `camera` in place and
 * calls `updateProjectionMatrix()` (required by Three.js after changing `aspect`,
 * easy to forget and silently get a stale projection otherwise). */
export function updateCameraForViewport(camera: THREE.PerspectiveCamera, viewportWidthPx: number, viewportHeightPx: number): void {
  const aspect = viewportHeightPx > 0 ? viewportWidthPx / viewportHeightPx : 1;
  if (camera.aspect === aspect) return;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
