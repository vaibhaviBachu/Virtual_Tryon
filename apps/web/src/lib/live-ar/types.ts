/**
 * Shared types for the Live AR pipeline (Milestone 5).
 *
 * COORDINATE SYSTEM (read docs/live-ar-architecture.md's "Coordinate systems" section
 * for the full account — this is the short version every module here relies on):
 *
 * - `NormalizedPoint` is [0,1], TOP-LEFT origin, x right / y down — the same convention
 *   `ai/landmarks/schemas.py` documents for the photo pipeline, and the convention
 *   MediaPipe's Tasks-Vision `FaceLandmarker`/`PoseLandmarker` already return results in
 *   (no manual normalization needed).
 * - MediaPipe's landmark results are always computed against the UNMIRRORED video frame
 *   (the raw `<video>` pixel buffer), regardless of whether the on-screen preview is
 *   mirrored with a CSS transform for a natural "looking in a mirror" UX. This module
 *   never assumes the preview is mirrored — `coordinates.ts` documents and tests the one
 *   place mirroring is allowed to matter (converting an UNMIRRORED point into mirrored
 *   *display* pixel space for the canvas overlay, never the other way around, and never
 *   for the landmarks driving the geometry math themselves).
 */

export interface NormalizedPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

/** Minimal pose landmark subset this module needs — MediaPipe Pose's 33-point
 * topology, indices 11/12 ("left_shoulder"/"right_shoulder", the subject's OWN
 * anatomical left/right — see ai/landmarks/pose.py and ai/geometry/rotation.py's
 * documented convention note this file's geometry.ts mirrors exactly). */
export interface LivePoseLandmarks {
  landmarks: NormalizedPoint[];
  confidence: number; // mirrors PoseLandmarkResult.shoulder_confidence
}

/** Minimal face landmark subset this module needs. `leftEar`/`rightEar` follow
 * ai/landmarks/face.py's SCREEN-POSITION convention (whichever face-oval edge landmark
 * has the smaller x is "left"), not a fixed anatomical MediaPipe index — see
 * geometry.ts's `resolveEarPoints` for why this matters. */
export interface LiveFaceLandmarks {
  landmarks: NormalizedPoint[];
  faceBoundingBox: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
  detectionConfidence: number;
}

export interface BodyReferenceFrame {
  leftShoulderPx: PixelPoint;
  rightShoulderPx: PixelPoint;
  shoulderMidpointPx: PixelPoint;
  shoulderWidthPx: number;
  verticalBodyDirection: readonly [number, number];
}

export interface AnchorResult {
  success: boolean;
  anchorPx: PixelPoint | null;
  referenceMeasurementPx: number | null;
  method: string;
  errorCode?: string;
}

export interface ScaleResult {
  success: boolean;
  scaleFactor: number;
  targetWidthPx: number | null;
  usedPhysicalDimensions: boolean;
  method: string;
}

export interface RotationResult {
  success: boolean;
  rotationDegrees: number;
  rawDegrees: number | null;
  clamped: boolean;
  method: string;
}

/** Mirrors ai/geometry/schemas.py's JewelleryAssetGeometry, computed once per loaded
 * asset texture (never per frame — spec §18). */
export interface JewelleryAssetGeometry {
  widthPx: number;
  heightPx: number;
  alphaBbox: [number, number, number, number]; // left, top, right, bottom (right/bottom exclusive)
  anchorPx: PixelPoint;
  anchorSource: "catalogue_metadata" | "default_bbox_top_center";
  mirrorable: boolean;
  physicalWidthMm: number | null;
}

/** A lightweight per-frame transform — deliberately NOT an image. The renderer applies
 * this to a cached texture; nothing here re-decodes or re-composites a full image
 * (spec §14/§15). */
export interface LiveTransform {
  anchorPx: PixelPoint; // BODY_ANCHOR in canvas pixel space (display/mirrored space)
  scaleFactor: number;
  rotationDegrees: number;
  sourceAnchorPx: PixelPoint; // JEWELLERY_ANCHOR in the asset's own pixel space
  mirrored: boolean;
}

export type TrackingStatus = "TRACKING_GOOD" | "TRACKING_DEGRADED" | "TRACKING_LOST";

export type CategorySlug = "earrings" | "necklace";
