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

/** Relative MediaPipe landmark depth (z) between two landmarks -- see depth.ts's file
 * docstring for the verified z convention (smaller z = closer to camera) and its one
 * critical caveat: this is only physically meaningful when both landmarks come from the
 * SAME model result (both FaceLandmarker, or both PoseLandmarker) -- FaceLandmarker's z
 * origin (center of head) and PoseLandmarker's z origin (hip midpoint) are NOT the same
 * point in space. Defined here (not in depth.ts) because it's referenced by
 * BodyReferenceFrame/NeckReferenceFrame/AnchorResult below, matching this file's
 * existing convention of holding every cross-module geometry shape. */
export interface RelativeDepthComparison {
  referenceZ: number;
  targetZ: number;
  /** targetZ - referenceZ. Negative means the target landmark is closer to the camera
   * than the reference landmark. */
  deltaZ: number;
  /** Convenience for deltaZ < 0. False on an exact tie (deltaZ === 0). */
  targetIsCloser: boolean;
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
  /** Phase F: MediaPipe FaceLandmarker's own real facial transformation matrix (a
   * flattened 4x4, enabled via `outputFacialTransformationMatrixes: true` in
   * tracking.ts) -- the actual rotation+translation fit of MediaPipe's canonical
   * face model onto this frame's detected face, NOT a 2D heuristic. Null whenever no
   * face was tracked, or the tracker didn't produce one for this frame -- never
   * fabricated. See three/head-pose.ts's `decomposeFacialTransformMatrix` for how
   * this is turned into a usable rotation, and that module's file docstring for the
   * one real, unverified-without-a-device assumption (column-major layout). */
  faceTransformMatrix: number[] | null;
}

export interface BodyReferenceFrame {
  leftShoulderPx: PixelPoint;
  rightShoulderPx: PixelPoint;
  shoulderMidpointPx: PixelPoint;
  shoulderWidthPx: number;
  verticalBodyDirection: readonly [number, number];
  /** Relative MediaPipe landmark depth (z) between the two shoulder landmarks -- see
   * depth.ts's file docstring for the verified z convention and why only same-model
   * (both PoseLandmarker) z values are safely comparable. Null whenever either
   * shoulder's z is missing/non-finite -- never fabricated. M6.2 foundation only: no
   * placement/rendering decision reads this field yet (see
   * docs/live-ar-realism-architecture.md §5/§17). */
  shoulderDepth: RelativeDepthComparison | null;
}

/**
 * The neck, as MediaPipe never gives it to us directly: derived from real, measured
 * landmarks (face bounding box + shoulder positions), never a raw invented pixel
 * offset. `attachmentPx` is an ESTIMATE (documented as such, never presented as a
 * directly observed landmark) of where a necklace's own attachment point should meet
 * the body -- near the base of the neck / collarbone -- computed by interpolating
 * along the REAL, per-frame measured distance between the bottom of the face bounding
 * box (a chin proxy) and the shoulder midpoint. See geometry.ts's
 * `computeNeckReferenceFrame` for the full derivation and why this adapts correctly to
 * camera distance, head tilt, and framing instead of a fixed constant. */
export interface NeckReferenceFrame {
  /** Where the necklace's own attachment point should be placed. */
  attachmentPx: PixelPoint;
  /** Horizontal center of the neck/body (shoulder midpoint x) -- the body centerline. */
  centerPx: PixelPoint;
  /** Estimated visible neck width in pixels. Diagnostic only today -- computeScale
   * still calibrates off the measured shoulder width (see its own docstring). */
  widthPx: number | null;
  /** The real, per-frame measured chin-proxy-to-shoulder distance this frame's
   * attachment point was interpolated along, in pixels. Null when no face was
   * available (fallback method). */
  neckLengthPx: number | null;
  shoulderWidthPx: number;
  confidence: number;
  method: "face_chin_to_shoulder_interpolation" | "shoulder_offset_fallback_no_face";
  /** Passed through from the underlying BodyReferenceFrame's shoulderDepth (see its own
   * doc comment) -- M6.2 foundation only, not consumed by anchor placement itself. */
  shoulderDepth: RelativeDepthComparison | null;
}

export interface AnchorResult {
  success: boolean;
  anchorPx: PixelPoint | null;
  referenceMeasurementPx: number | null;
  method: string;
  errorCode?: string;
  /** M6.2 depth foundation (docs/live-ar-realism-architecture.md §5/§17): relative
   * shoulder depth passed through from the neck reference frame, for the necklace
   * category only (earrings have no shoulder/body reference to draw from, so this is
   * always undefined there). Never read by computeScale/computeRotation/rendering --
   * exposed for M6.3+ to build on, not consumed yet. */
  bodyDepth?: RelativeDepthComparison | null;
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
