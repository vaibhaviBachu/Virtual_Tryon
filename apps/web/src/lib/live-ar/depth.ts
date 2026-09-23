/**
 * Relative landmark depth — the M6.2 depth foundation
 * (docs/live-ar-realism-architecture.md §5/§17). Pure comparison of two `z` values
 * MediaPipe already attaches to each landmark (tracking.ts already captures them --
 * see types.ts's `NormalizedPoint.z` -- but nothing downstream has consumed them until
 * this module). No Canvas, no camera, no React, no MediaPipe import here.
 *
 * WHAT THIS IS NOT (see docs/live-ar-realism-architecture.md §5's own disclaimer):
 * this is NOT absolute/metric depth, NOT a dense per-pixel depth map, and NOT jewellery
 * render depth -- none of those exist in this codebase yet. This module only answers
 * "given two landmarks MediaPipe already tracked, which one does MediaPipe's own model
 * think is closer to the camera" -- a relative, model-reported signal, nothing more.
 *
 * VERIFIED MEDIAPIPE Z CONVENTION (Google's own published docs -- not assumed; see
 * Sources at the bottom of docs/live-ar-realism-architecture.md and this module's own
 * test file for the citations):
 * - FaceLandmarker: z's origin is the CENTER OF THE HEAD. Smaller (more negative) z
 *   means closer to the camera. Magnitude is roughly on the same normalized scale as x.
 * - PoseLandmarker: z's origin is the MIDPOINT OF THE HIPS. Same "smaller = closer"
 *   direction, same roughly-x-scale magnitude.
 * - CRITICAL, easy-to-miss caveat: those are TWO DIFFERENT ORIGINS. A FaceLandmarker z
 *   value and a PoseLandmarker z value are not expressed relative to the same point in
 *   space, so directly comparing "face z" against "shoulder z" is comparing two
 *   different coordinate systems, not two depths in one shared space -- it would look
 *   like a valid subtraction but would not mean anything physically. This module
 *   therefore only ever compares landmarks known to come from the SAME model result
 *   (both from one FaceLandmarker call, or both from one PoseLandmarker call).
 *   Cross-model (face-vs-pose) depth comparison is explicitly out of scope until a
 *   deliberate, verified normalization step is added -- not attempted in M6.2.
 */
import type { LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

const LEFT_SHOULDER_IDX = 11;
const RIGHT_SHOULDER_IDX = 12;

export interface RelativeDepthComparison {
  referenceZ: number;
  targetZ: number;
  /** targetZ - referenceZ. Negative means the target landmark is closer to the camera
   * than the reference landmark (smaller z = closer, per the verified convention above). */
  deltaZ: number;
  /** Convenience for deltaZ < 0. False on an exact tie (deltaZ === 0) -- a tie is not
   * "closer." */
  targetIsCloser: boolean;
}

/** A landmark's own z, or null when it's missing or not a finite number. MediaPipe does
 * not guarantee every landmark carries a z, and this project never fabricates one --
 * "unavailable" is always represented explicitly, never as 0 or any other placeholder. */
export function safeLandmarkZ(point: NormalizedPoint | undefined | null): number | null {
  if (!point) return null;
  const z = point.z;
  if (z === undefined || !Number.isFinite(z)) return null;
  return z;
}

/** Compares two landmarks' z values. Returns null (never a fabricated number) when
 * either z is missing or non-finite. ONLY valid when `reference` and `target` come from
 * the SAME MediaPipe model result -- see this file's docstring; this function has no
 * way to enforce that itself, so it is the caller's responsibility. */
export function compareRelativeDepth(
  reference: NormalizedPoint | undefined | null,
  target: NormalizedPoint | undefined | null
): RelativeDepthComparison | null {
  const referenceZ = safeLandmarkZ(reference);
  const targetZ = safeLandmarkZ(target);
  if (referenceZ === null || targetZ === null) return null;
  const deltaZ = targetZ - referenceZ;
  return { referenceZ, targetZ, deltaZ, targetIsCloser: deltaZ < 0 };
}

/**
 * Shoulder depth asymmetry from PoseLandmarker's own two shoulder landmarks (11/12 --
 * same indices body-reference.ts uses). Both landmarks come from the same
 * PoseLandmarker call, so they share the hip-midpoint z origin and this comparison is
 * physically meaningful (unlike a face-vs-pose comparison -- see file docstring).
 *
 * `targetIsCloser: true` means the LEFT shoulder (MediaPipe's anatomical left, landmark
 * 11) is closer to the camera than the right -- a possible signal of body/shoulder
 * rotation. Nothing in this codebase consumes that signal yet; this function only
 * exposes it (docs/live-ar-realism-architecture.md §13 names a future perspective phase
 * as the eventual consumer, not this milestone).
 */
export function computeShoulderDepthAsymmetry(pose: LivePoseLandmarks | null): RelativeDepthComparison | null {
  if (pose === null) return null;
  const { landmarks } = pose;
  if (landmarks.length <= Math.max(LEFT_SHOULDER_IDX, RIGHT_SHOULDER_IDX)) return null;
  return compareRelativeDepth(landmarks[RIGHT_SHOULDER_IDX], landmarks[LEFT_SHOULDER_IDX]);
}
