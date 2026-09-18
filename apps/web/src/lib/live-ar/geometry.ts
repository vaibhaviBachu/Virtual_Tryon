/**
 * Live geometry — TypeScript port of ai/geometry/{anchors,scale,rotation}.py
 * (Milestone 4), reused for Live AR (Milestone 5 spec §3, §13, §14) so the browser
 * computes the identical anchor/scale/rotation math the server-side photo engine does,
 * for the same landmarks. This module produces ONLY numbers (a `LiveTransform`) — no
 * image decoding or compositing happens here (spec §14's "separate GEOMETRY from IMAGE
 * COMPOSITING" requirement); renderer.ts consumes this module's output.
 *
 * KNOWN LIMITATION — same as the Python engine (see ai/geometry/rotation.py,
 * ai/geometry/scale.py module docstrings): rotation is a 2D in-plane estimate only (no
 * 3D head pose), and scale uses a documented anthropometric-average physical
 * calibration, not per-user measurement. Nothing here claims otherwise.
 *
 * DELIBERATE DIVERGENCE FROM THE PYTHON EARRING ROTATION FORMULA (found during this
 * milestone's audit, not fixed in Python since it was not reported/reproduced there and
 * touching Milestone 4 code is out of this milestone's scope — see
 * docs/live-ar-architecture.md's "Known Limitations"): ai/geometry/rotation.py's
 * `_compute_earring_rotation` uses FaceMesh landmarks 234/454 by FIXED index as
 * "left"/"right", but ai/landmarks/face.py's own ear-anchor code deliberately does NOT
 * trust those indices' left/right identity — it resolves left/right dynamically by
 * comparing x-coordinates instead (`edge_a.x <= edge_b.x`). This milestone's own
 * necklace-rotation investigation found a real, confirmed ~180deg sign-inversion bug
 * from exactly this class of mistake (a fixed-index assumption that doesn't hold for
 * every photo). Rather than risk shipping the same bug pattern in new code, this
 * module's `computeEarringRotation` resolves left/right the SAME safe way
 * `resolveEarPoints` (ported from ai/landmarks/face.py) already does, rather than
 * copying rotation.py's fixed-index formula verbatim.
 */
import { computeBodyReferenceFrame } from "@/lib/live-ar/body-reference";
import {
  AVERAGE_ADULT_FACE_WIDTH_MM,
  AVERAGE_ADULT_SHOULDER_WIDTH_MM,
  EARRING_RELATIVE_SCALE_OF_FACE_WIDTH,
  EAR_ANCHOR_VERTICAL_OFFSET_FRACTION,
  EAR_CONFIDENCE_THRESHOLD,
  FACE_CONFIDENCE_THRESHOLD,
  MAX_EARRING_ROTATION_DEGREES,
  MAX_NECKLACE_ROTATION_DEGREES,
  MAX_SCALE_FACTOR,
  MIN_SCALE_FACTOR,
  NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION,
  NECKLACE_LENGTH_OFFSET_MULTIPLIER,
  NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH,
} from "@/lib/live-ar/constants";
import type {
  AnchorResult,
  CategorySlug,
  JewelleryAssetGeometry,
  LiveFaceLandmarks,
  LivePoseLandmarks,
  NormalizedPoint,
  PixelPoint,
  RotationResult,
  ScaleResult,
} from "@/lib/live-ar/types";

const NOSE_TIP_IDX = 1;
const LEFT_EDGE_IDX = 234;
const RIGHT_EDGE_IDX = 454;
const LEFT_SHOULDER_IDX = 11;
const RIGHT_SHOULDER_IDX = 12;
const EAR_HEURISTIC_CONFIDENCE_CEILING = 0.85;

// --- Ear resolution (ports ai/landmarks/face.py's _estimate_ears_and_yaw, screen-
// position convention: whichever face-oval edge landmark has the smaller x is "left"). ---
export function resolveEarPoints(
  landmarks: NormalizedPoint[]
): { left: NormalizedPoint; right: NormalizedPoint } | null {
  if (landmarks.length <= Math.max(NOSE_TIP_IDX, LEFT_EDGE_IDX, RIGHT_EDGE_IDX)) return null;
  const edgeA = landmarks[LEFT_EDGE_IDX];
  const edgeB = landmarks[RIGHT_EDGE_IDX];
  return edgeA.x <= edgeB.x ? { left: edgeA, right: edgeB } : { left: edgeB, right: edgeA };
}

/** Ports ai/landmarks/face.py's `_estimate_ears_and_yaw` confidence heuristic: the ear
 * on the side the head is turned AWAY from (more foreshortened relative to the nose)
 * gets a lower confidence, capped below `EAR_HEURISTIC_CONFIDENCE_CEILING` since this is
 * a 2D geometric heuristic, never a calibrated 3D visibility measurement. */
export function resolveEarConfidence(
  landmarks: NormalizedPoint[],
  detectionConfidence: number
): { left: number; right: number } | null {
  if (landmarks.length <= Math.max(NOSE_TIP_IDX, LEFT_EDGE_IDX, RIGHT_EDGE_IDX)) return null;
  const nose = landmarks[NOSE_TIP_IDX];
  const edgeA = landmarks[LEFT_EDGE_IDX];
  const edgeB = landmarks[RIGHT_EDGE_IDX];
  const [leftPoint, rightPoint] = edgeA.x <= edgeB.x ? [edgeA, edgeB] : [edgeB, edgeA];
  const distLeft = Math.hypot(nose.x - leftPoint.x, nose.y - leftPoint.y);
  const distRight = Math.hypot(nose.x - rightPoint.x, nose.y - rightPoint.y);
  const total = distLeft + distRight;
  const asymmetry = total === 0 ? 0 : (distRight - distLeft) / total;

  const confidenceFor = (isLeft: boolean) => {
    const penalty = Math.max(0, isLeft ? asymmetry : -asymmetry);
    const base = detectionConfidence * EAR_HEURISTIC_CONFIDENCE_CEILING;
    return Math.max(0, base * (1 - penalty));
  };
  return { left: confidenceFor(true), right: confidenceFor(false) };
}

function computeEarAnchor(
  side: "left" | "right" | null,
  face: LiveFaceLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number
): AnchorResult {
  if (face === null || side === null || face.detectionConfidence < FACE_CONFIDENCE_THRESHOLD) {
    return { success: false, anchorPx: null, referenceMeasurementPx: null, method: "none", errorCode: "FACE_NOT_VISIBLE" };
  }
  const ears = resolveEarPoints(face.landmarks);
  const confidences = resolveEarConfidence(face.landmarks, face.detectionConfidence);
  if (ears === null || confidences === null) {
    return { success: false, anchorPx: null, referenceMeasurementPx: null, method: "none", errorCode: "FACE_NOT_VISIBLE" };
  }
  const confidence = side === "left" ? confidences.left : confidences.right;
  if (confidence < EAR_CONFIDENCE_THRESHOLD) {
    return {
      success: false,
      anchorPx: null,
      referenceMeasurementPx: null,
      method: "none",
      errorCode: confidence <= 0 ? "EAR_NOT_VISIBLE" : "LOW_EAR_CONFIDENCE",
    };
  }

  const point = side === "left" ? ears.left : ears.right;
  const bbox = face.faceBoundingBox;
  const faceWidthPx = bbox ? (bbox.xMax - bbox.xMin) * imageWidthPx : 0;
  const faceHeightPx = bbox ? (bbox.yMax - bbox.yMin) * imageHeightPx : 0;

  const rawXPx = point.x * imageWidthPx;
  const rawYPx = point.y * imageHeightPx;
  const anchorPx: PixelPoint = { x: rawXPx, y: rawYPx + EAR_ANCHOR_VERTICAL_OFFSET_FRACTION * faceHeightPx };

  return {
    success: true,
    anchorPx,
    referenceMeasurementPx: faceWidthPx,
    method: "face_mesh_edge_landmark_with_earlobe_offset",
  };
}

function computeNecklaceAnchor(
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number,
  necklaceLength: string | null
): AnchorResult {
  const frame = computeBodyReferenceFrame(pose, imageWidthPx, imageHeightPx);
  if (frame === null) {
    return { success: false, anchorPx: null, referenceMeasurementPx: null, method: "none", errorCode: "NECK_NOT_VISIBLE" };
  }
  const lengthMultiplier = necklaceLength !== null ? (NECKLACE_LENGTH_OFFSET_MULTIPLIER[necklaceLength] ?? 1.0) : 1.0;
  const [dx, dy] = frame.verticalBodyDirection;
  const offsetPx = NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION * lengthMultiplier * frame.shoulderWidthPx;
  const anchorPx: PixelPoint = {
    x: frame.shoulderMidpointPx.x + dx * offsetPx,
    y: frame.shoulderMidpointPx.y + dy * offsetPx,
  };
  return {
    success: true,
    anchorPx,
    referenceMeasurementPx: frame.shoulderWidthPx,
    method: "pose_shoulder_midpoint_with_collarbone_offset",
  };
}

export function computeAnchor(
  category: CategorySlug,
  side: "left" | "right" | null,
  face: LiveFaceLandmarks | null,
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number,
  necklaceLength: string | null = null
): AnchorResult {
  if (category === "earrings") return computeEarAnchor(side, face, imageWidthPx, imageHeightPx);
  if (category === "necklace") return computeNecklaceAnchor(pose, imageWidthPx, imageHeightPx, necklaceLength);
  return { success: false, anchorPx: null, referenceMeasurementPx: null, method: "none", errorCode: "UNSUPPORTED_CATEGORY" };
}

// --- Scale (ports ai/geometry/scale.py) ---
export function computeScale(category: CategorySlug, assetGeometry: JewelleryAssetGeometry, anchor: AnchorResult): ScaleResult {
  if (!anchor.success || !anchor.referenceMeasurementPx) {
    return { success: false, scaleFactor: 0, targetWidthPx: null, usedPhysicalDimensions: false, method: "no_reference_measurement" };
  }
  const effectiveWidthPx = assetGeometry.alphaBbox[2] - assetGeometry.alphaBbox[0];
  if (effectiveWidthPx <= 0) {
    return { success: false, scaleFactor: 0, targetWidthPx: null, usedPhysicalDimensions: false, method: "asset_has_no_measurable_width" };
  }

  let targetWidthPx: number;
  let usedPhysical: boolean;
  let method: string;
  if (category === "earrings") {
    if (assetGeometry.physicalWidthMm) {
      const pxPerMm = anchor.referenceMeasurementPx / AVERAGE_ADULT_FACE_WIDTH_MM;
      targetWidthPx = assetGeometry.physicalWidthMm * pxPerMm;
      usedPhysical = true;
      method = "physical_mm_via_face_width_calibration";
    } else {
      targetWidthPx = EARRING_RELATIVE_SCALE_OF_FACE_WIDTH * anchor.referenceMeasurementPx;
      usedPhysical = false;
      method = "relative_to_face_width";
    }
  } else if (category === "necklace") {
    if (assetGeometry.physicalWidthMm) {
      const pxPerMm = anchor.referenceMeasurementPx / AVERAGE_ADULT_SHOULDER_WIDTH_MM;
      targetWidthPx = assetGeometry.physicalWidthMm * pxPerMm;
      usedPhysical = true;
      method = "physical_mm_via_shoulder_width_calibration";
    } else {
      targetWidthPx = NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH * anchor.referenceMeasurementPx;
      usedPhysical = false;
      method = "relative_to_shoulder_width";
    }
  } else {
    return { success: false, scaleFactor: 0, targetWidthPx: null, usedPhysicalDimensions: false, method: "unsupported_category" };
  }

  const rawScaleFactor = targetWidthPx / effectiveWidthPx;
  const scaleFactor = Math.min(Math.max(rawScaleFactor, MIN_SCALE_FACTOR), MAX_SCALE_FACTOR);
  return { success: true, scaleFactor, targetWidthPx, usedPhysicalDimensions: usedPhysical, method };
}

// --- Rotation (ports ai/geometry/rotation.py's necklace formula exactly, including the
// left/right sign-convention fix shipped this session; see this module's file docstring
// for why the earring formula deliberately does NOT copy the Python file verbatim). ---
export function computeNecklaceRotation(pose: LivePoseLandmarks | null, imageWidthPx: number, imageHeightPx: number): RotationResult {
  if (pose === null || pose.landmarks.length <= Math.max(LEFT_SHOULDER_IDX, RIGHT_SHOULDER_IDX)) {
    return { success: false, rotationDegrees: 0, rawDegrees: null, clamped: false, method: "neutral_fallback_no_landmarks" };
  }
  const left = pose.landmarks[LEFT_SHOULDER_IDX];
  const right = pose.landmarks[RIGHT_SHOULDER_IDX];
  // MediaPipe Pose landmarks 11/12 are the subject's own ANATOMICAL left/right (see
  // ai/landmarks/pose.py). For an ordinary, non-mirrored, front-facing photo the
  // anatomical left shoulder appears on the image's RIGHT side (larger x) — the
  // direction vector below goes FROM right TO left, matching the fix shipped in
  // ai/geometry/rotation.py this session (see that file's docstring for the full
  // derivation and the real production render that exposed the original bug).
  const dx = (left.x - right.x) * imageWidthPx;
  const dy = (left.y - right.y) * imageHeightPx;
  const rawDegrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const clampedDegrees = Math.min(MAX_NECKLACE_ROTATION_DEGREES, Math.max(-MAX_NECKLACE_ROTATION_DEGREES, rawDegrees));
  return {
    success: true,
    rotationDegrees: clampedDegrees,
    rawDegrees,
    clamped: clampedDegrees !== rawDegrees,
    method: "shoulder_landmark_tilt",
  };
}

export function computeEarringRotation(face: LiveFaceLandmarks | null, imageWidthPx: number, imageHeightPx: number): RotationResult {
  if (face === null) {
    return { success: false, rotationDegrees: 0, rawDegrees: null, clamped: false, method: "neutral_fallback_no_landmarks" };
  }
  const ears = resolveEarPoints(face.landmarks);
  if (ears === null) {
    return { success: false, rotationDegrees: 0, rawDegrees: null, clamped: false, method: "neutral_fallback_no_landmarks" };
  }
  // See this module's file docstring: left/right resolved dynamically by x-comparison
  // (ai/landmarks/face.py's convention), not a fixed MediaPipe index pair.
  const dx = (ears.right.x - ears.left.x) * imageWidthPx;
  const dy = (ears.right.y - ears.left.y) * imageHeightPx;
  const rawDegrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const clampedDegrees = Math.min(MAX_EARRING_ROTATION_DEGREES, Math.max(-MAX_EARRING_ROTATION_DEGREES, rawDegrees));
  return {
    success: true,
    rotationDegrees: clampedDegrees,
    rawDegrees,
    clamped: clampedDegrees !== rawDegrees,
    method: "face_edge_landmark_roll",
  };
}

export function computeRotation(category: CategorySlug, face: LiveFaceLandmarks | null, pose: LivePoseLandmarks | null, imageWidthPx: number, imageHeightPx: number): RotationResult {
  if (category === "earrings") return computeEarringRotation(face, imageWidthPx, imageHeightPx);
  if (category === "necklace") return computeNecklaceRotation(pose, imageWidthPx, imageHeightPx);
  return { success: false, rotationDegrees: 0, rawDegrees: null, clamped: false, method: "unsupported_category" };
}

/** Combines an anchor/scale/rotation result plus the loaded asset's own geometry into
 * the single lightweight LiveTransform the renderer applies to the cached texture. This
 * is the browser-side equivalent of ai/geometry/transform.py's `compute_transform` --
 * same anchor-coincidence composition (BODY_ANCHOR = target, JEWELLERY_ANCHOR = source),
 * but returns the transform PARAMETERS (translate/rotate/scale) rather than a baked 2x3
 * matrix, since Canvas 2D's own `translate`/`rotate`/`scale` calls compose the same
 * result without this module needing to hand-multiply matrices (see renderer.ts).
 * Returns null if any input failed -- callers should treat that the same as a lost/
 * degraded tracking frame (see tracking-state.ts), never render a partial transform. */
export function buildLiveTransform(
  assetGeometry: JewelleryAssetGeometry,
  anchor: AnchorResult,
  scale: ScaleResult,
  rotation: RotationResult,
  mirrored: boolean
): import("@/lib/live-ar/types").LiveTransform | null {
  if (!anchor.success || anchor.anchorPx === null) return null;
  if (!scale.success) return null;
  if (!rotation.success) return null;
  return {
    anchorPx: anchor.anchorPx,
    scaleFactor: scale.scaleFactor,
    rotationDegrees: rotation.rotationDegrees,
    sourceAnchorPx: assetGeometry.anchorPx,
    mirrored,
  };
}

/** One renderable unit for a frame: a slot (e.g. "left"/"right" for a pair of
 * earrings, or "necklace" for the single necklace anchor) plus the transform to draw
 * there, or null if that slot's placement could not be computed this frame. */
export interface CategoryRenderPlan {
  slot: "left" | "right" | "necklace";
  transform: import("@/lib/live-ar/types").LiveTransform | null;
}

/** Plans everything that needs to be drawn for the current category selection, in one
 * call, so the render loop (the React hook that owns requestAnimationFrame) doesn't
 * have to re-implement per-category branching itself. For "earrings", always plans
 * BOTH slots (a real try-on shows both ears at once): the right slot is drawn mirrored
 * from the same asset when `assetGeometry.mirrorable` is true (a symmetric
 * single-design earring, spec §11), or with the identical (unmirrored) transform
 * otherwise -- documented as a known limitation for a deliberately asymmetric
 * left/right earring pair design, which this milestone's catalogue does not yet model
 * as two distinct assets. */
export function planCategoryRenders(
  category: CategorySlug,
  assetGeometry: JewelleryAssetGeometry,
  face: LiveFaceLandmarks | null,
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number,
  necklaceLength: string | null = null
): CategoryRenderPlan[] {
  if (category === "necklace") {
    const anchor = computeAnchor("necklace", null, null, pose, imageWidthPx, imageHeightPx, necklaceLength);
    const scale = computeScale("necklace", assetGeometry, anchor);
    const rotation = computeRotation("necklace", null, pose, imageWidthPx, imageHeightPx);
    return [{ slot: "necklace", transform: buildLiveTransform(assetGeometry, anchor, scale, rotation, false) }];
  }

  // earrings
  const leftAnchor = computeAnchor("earrings", "left", face, null, imageWidthPx, imageHeightPx);
  const leftScale = computeScale("earrings", assetGeometry, leftAnchor);
  const rotation = computeRotation("earrings", face, null, imageWidthPx, imageHeightPx);
  const leftTransform = buildLiveTransform(assetGeometry, leftAnchor, leftScale, rotation, false);

  const rightAnchor = computeAnchor("earrings", "right", face, null, imageWidthPx, imageHeightPx);
  const rightScale = computeScale("earrings", assetGeometry, rightAnchor);
  // A mirrored asset's right-ear placement flips the SAME source texture horizontally
  // (see renderer.ts's drawJewelleryOverlay) rather than needing a second asset.
  const rightTransform = buildLiveTransform(assetGeometry, rightAnchor, rightScale, rotation, assetGeometry.mirrorable);

  return [
    { slot: "left", transform: leftTransform },
    { slot: "right", transform: rightTransform },
  ];
}
