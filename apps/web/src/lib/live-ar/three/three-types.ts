/**
 * M6.8 3D rendering foundation — shared types + the coordinate system contract (spec
 * Step 8: "Document the coordinate conventions... do not leave coordinate assumptions
 * implicit").
 *
 * COORDINATE CONVENTIONS (read this before touching anything under live-ar/three/):
 *
 * - **Units**: millimeters everywhere a physical size is involved (matches the
 *   catalogue's own `physical_width_mm`/`physical_height_mm`/`physical_depth_mm`
 *   columns — a REAL unit, not an arbitrary "shoulder-width" or "screen-pixel" unit).
 * - **World space**: Three.js's own default convention — right-handed, +Y up, camera
 *   looks down its own local -Z axis. Never overridden.
 * - **Origin**: the camera itself sits at world origin (0,0,0). There is no separate
 *   "body space" origin distinct from the camera — the camera is fixed and the
 *   jewellery is positioned in front of it every frame (mirrors how the existing 2D
 *   pipeline already treats the video frame as the fixed reference and the jewellery
 *   as the thing that moves).
 * - **Handedness**: right-handed (Three.js default). A positive rotation around +Y is
 *   counter-clockwise when viewed from above (looking down -Y), matching Three.js's
 *   own `Euler`/`Quaternion` convention exactly — nothing here redefines it.
 * - **Camera forward direction**: -Z (Three.js default). The jewellery is placed at a
 *   NEGATIVE Z (in front of the camera) — see three-transform.ts's `computeVirtualDepthMm`.
 * - **FOV / aspect / near / far**: FOV is an ASSUMED value (`DEFAULT_VERTICAL_FOV_DEGREES`
 *   below) — HONEST LIMITATION: this pipeline has no calibrated real-camera intrinsics
 *   (no measured focal length from the actual webcam), so a real-camera FOV is not
 *   available to use here. The assumed FOV does not silently bias on-screen size,
 *   because `computeVirtualDepthMm` (three-transform.ts) DERIVES the jewellery's
 *   distance from the camera FROM the already-validated 2D scale factor, for whatever
 *   FOV is configured — the projected on-screen size is guaranteed to match the
 *   existing (already real-device-tested across M6.1-M6.6) 2D placement regardless of
 *   which FOV number is chosen. Aspect ratio is the real video viewport's own
 *   width/height (never assumed). Near/far are generous, arbitrary clip-plane bounds
 *   (1mm / 10000mm) — they only need to safely contain "a piece of jewellery a few
 *   hundred mm from the camera," never a calibrated value.
 * - **Screen -> world mapping**: MediaPipe normalized [0,1] landmarks are converted to
 *   canvas PIXEL space by the EXISTING geometry.ts/neck-reference.ts pipeline, exactly
 *   as they are for the 2D renderer today (unchanged — see this module's docstring in
 *   three-transform.ts for where the 3D path picks up from that same pixel anchor,
 *   never re-deriving it from raw landmarks a second time).
 *
 * PIPELINE (spec Step 6's diagram, restated in this codebase's actual module names):
 *   tracking.ts (unchanged)
 *     -> geometry.ts / neck-reference.ts (unchanged: produces the 2D anchor px + scale)
 *     -> three-transform.ts (NEW: 2D anchor/scale -> 3D position/rotation/scale)
 *     -> three-camera.ts (NEW: the fixed virtual camera)
 *     -> three-renderer.ts (NEW: render the mesh through that camera)
 *     -> renderer.ts's existing occlusion compositing (unchanged mechanism, new input)
 */
import type * as THREE from "three";

/** A vertical FOV assumption -- see this file's docstring for why the choice doesn't
 * bias on-screen size. 50 degrees is a generic "webcam-like" default with no special
 * significance beyond being a reasonable middle value; UNCALIBRATED, same status as
 * every other visual constant in this project's Live AR pipeline. */
export const DEFAULT_VERTICAL_FOV_DEGREES = 50;
export const DEFAULT_NEAR_MM = 1;
export const DEFAULT_FAR_MM = 10000;

export interface ThreeCameraConfig {
  verticalFovDegrees: number;
  aspect: number; // viewportWidthPx / viewportHeightPx -- the REAL video viewport, never assumed
  nearMm: number;
  farMm: number;
}

/** The jewellery's resolved position/orientation/scale in Three.js world space, ready
 * to assign directly to an `Object3D`'s `.position`/`.quaternion`/`.scale` -- see
 * three-transform.ts for how this is derived from the existing 2D pipeline's output. */
export interface ThreeJewelleryTransform {
  positionMm: { x: number; y: number; z: number };
  /** [x, y, z, w] -- Three.js's own Quaternion component order. */
  quaternion: [number, number, number, number];
  /** Uniform scale factor to apply to the mesh's own authored (mm) dimensions. 1.0
   * means the mesh's authored size is used exactly as modeled. */
  scale: number;
}

/** Loaded + cached GLTF result, trimmed to what this codebase's renderer actually
 * needs (never the full loader-internal `GLTF` type, which also carries animations/
 * cameras/scenes this pipeline never uses -- spec Step 4's "do not over-engineer"). */
export interface LoadedGltfAsset {
  /** The root object to add to the scene. Cloned per use (see three-asset-loader.ts)
   * so multiple simultaneously-worn items sharing one cached GLB never fight over the
   * same Object3D's transform. */
  scene: THREE.Group;
  /** The mesh's own authored bounding box, in the GLB's local units (assumed mm, per
   * spec Step 20's asset spec) -- used to derive `scale` in three-transform.ts from
   * the catalogue's physical_width_mm rather than trusting the artist's own scale. */
  boundingBox: THREE.Box3;
}
