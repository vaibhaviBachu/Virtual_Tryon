/**
 * Live AR necklace geometry debug snapshot -- Live-AR-only diagnostic tooling (no
 * rendering, no Python mirror). This module exists so a real question ("where does the
 * algorithm THINK the neck is, on THIS actual frame, on a real camera") can be answered
 * with real runtime numbers instead of a screenshot and a guess. It assembles every
 * intermediate value the necklace pipeline computes -- face/shoulder landmarks, the
 * estimated neck reference, the jewellery asset's own geometry, and the final transform
 * -- into one plain object, and `renderer.ts`'s `drawNecklaceDebugOverlay` draws it onto
 * the SAME unmirrored canvas the jewellery itself is drawn on (the wrapping <div>'s CSS
 * mirror transform in useLiveArSession.ts flips the whole canvas for display, so a debug
 * point drawn at a raw pixel coordinate here shows up in the correct mirrored place on
 * screen automatically, exactly like the jewellery sprite already does).
 *
 * M6.2 depth foundation (docs/live-ar-realism-architecture.md §5/§17, §8-9): also
 * reports the raw z values behind `computeShoulderDepthAsymmetry` (depth.ts), as a
 * numeric-only diagnostic -- no visual/rendering change, extending this existing debug
 * mechanism rather than adding a second one (per the request that produced this
 * milestone). Deliberately does NOT report a "neck z": the neck-reference point is a 2D
 * interpolation with no MediaPipe landmark of its own, so it has no real z to report --
 * reporting one would be exactly the kind of fabricated number this project's docs
 * repeatedly prohibit.
 */
import { applyLiveTransformToPoint, computeTransformedBoundingBox, resolveEarPoints } from "@/lib/live-ar/geometry";
import { safeLandmarkZ } from "@/lib/live-ar/depth";
import { computeNeckReferenceFrame } from "@/lib/live-ar/neck-reference";
import { computeNeckSurfaceDebugPoints } from "@/lib/live-ar/neck-surface";
import type { JewelleryStrip } from "@/lib/live-ar/jewellery-deformation";
import type { JewelleryAssetGeometry, LiveFaceLandmarks, LivePoseLandmarks, LiveTransform, PixelPoint } from "@/lib/live-ar/types";

/** M6.6 ("Wear Geometry Debug" -- spec Step 2/11): the SAME strip plan/foreshorten
 * already computed for actual rendering this frame (useLiveArSession.ts's
 * `deformationFor`), passed in rather than recomputed here, so this debug
 * visualization can never show a different curve than what was actually drawn. Null
 * (the default) draws none of the new M6.6 markers -- byte-for-byte the pre-M6.6
 * NecklaceDebugSnapshot. */
export interface WearGeometryDebugInput {
  strips: JewelleryStrip[] | null;
  horizontalForeshorten: number;
  contactPeakFraction: number;
  yawAsymmetry: number;
}

const LEFT_SHOULDER_IDX = 11;
const RIGHT_SHOULDER_IDX = 12;
// Mirrors geometry.ts's own local NOSE_TIP_IDX -- duplicated here rather than imported,
// matching this file's existing convention of keeping its own local landmark indices
// (see LEFT_SHOULDER_IDX/RIGHT_SHOULDER_IDX above) instead of depending on geometry.ts's
// internals.
const NOSE_TIP_IDX = 1;

export interface NecklaceDebugSnapshot {
  imageWidthPx: number;
  imageHeightPx: number;

  faceCenterPx: PixelPoint | null;
  faceWidthPx: number | null;
  chinProxyYPx: number | null; // bottom of the FaceLandmarker bounding box
  leftEarPx: PixelPoint | null;
  rightEarPx: PixelPoint | null;

  leftShoulderPx: PixelPoint | null;
  rightShoulderPx: PixelPoint | null;
  shoulderMidpointPx: PixelPoint | null;
  shoulderWidthPx: number | null;

  neckCenterPx: PixelPoint | null;
  neckAttachmentPx: PixelPoint | null;
  neckWidthPx: number | null;
  neckConfidence: number | null;
  neckMethod: string | null;

  assetWidthPx: number;
  assetHeightPx: number;
  assetAlphaBbox: [number, number, number, number];
  assetAttachmentPx: PixelPoint;

  scaleFactor: number;
  rotationDegrees: number;
  finalAttachmentPx: PixelPoint;
  /** The asset's OWN attachment point (assetAttachmentPx), mapped through the exact
   * same transform as everything else in this snapshot. By construction this MUST
   * equal `finalAttachmentPx` (assetAttachmentPx literally IS transform.sourceAnchorPx,
   * so transforming it is mathematically guaranteed to land exactly on
   * transform.anchorPx). This field exists purely as a self-check: if it and
   * `finalAttachmentPx` ever print DIFFERENT values, that is proof of a real bug (stale
   * closure, mismatched transform object, etc), not a calibration issue -- if they
   * match but the on-screen result still looks wrong, the bug is elsewhere (a stale
   * build, or the visual interpretation of where the asset's attachment SHOULD be). */
  transformedAssetAttachmentPx: PixelPoint;
  finalVisibleBboxPx: [number, number, number, number]; // left, top, right, bottom in canvas space

  // M6.2 depth foundation -- relative MediaPipe landmark z, NOT dense depth, NOT
  // jewellery render depth (see depth.ts's file docstring). null whenever the source
  // landmark's z is missing/non-finite (never fabricated). faceNoseZ and the shoulder
  // z's use DIFFERENT MediaPipe origins (center-of-head vs hip-midpoint) and are NOT
  // directly comparable to each other -- see formatNecklaceDebugSnapshot's own note.
  faceNoseZ: number | null;
  leftShoulderZ: number | null;
  rightShoulderZ: number | null;
  /** leftShoulderZ - rightShoulderZ (same as computeShoulderDepthAsymmetry's deltaZ).
   * Negative means the left shoulder is closer to the camera. Null unless both
   * shoulders' z are available. */
  shoulderDepthDeltaZ: number | null;

  // M6.6 ("Wear Geometry Debug") -- null exactly when `wearDebug` wasn't passed to
  // computeNecklaceDebugSnapshot (earrings, or the toggle is off) or the neck reference
  // frame has no width estimate (see neck-surface.ts's own null case).
  leftNeckBoundaryPx: PixelPoint | null;
  rightNeckBoundaryPx: PixelPoint | null;
  neckRadiusPx: number | null;
  /** Canvas-space points tracing the jewellery's ACTUAL contact curve this frame (one
   * per strip, center-of-strip x, its real dropPx y) -- mapped through the SAME
   * `applyLiveTransformToPoint` used everywhere else in this file, so this can never
   * show a curve different from the transform that was actually used. Does NOT
   * additionally apply `horizontalForeshorten` (a renderer-only whole-sprite X scale
   * outside `LiveTransform`) -- a documented simplification, most visible at extreme
   * yaw; the horizontal POSITIONS here are the pre-foreshorten ones, while the actual
   * render also compresses them slightly further toward center. */
  contactCurvePx: PixelPoint[];
  yawAsymmetry: number | null;
  contactPeakFraction: number | null;
  horizontalForeshorten: number | null;
}

function fmtPt(p: PixelPoint | null): string {
  return p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})` : "null";
}

function fmtNum(n: number | null): string {
  return n === null ? "null" : n.toFixed(2);
}

/** Plain-text rendering of a snapshot for an on-screen readout / copy-pasteable report
 * -- the exact numbers behind the debug overlay's drawn points, for the actual live
 * frame that produced them (never a unit-test fixture). */
export function formatNecklaceDebugSnapshot(s: NecklaceDebugSnapshot): string {
  return [
    `IMAGE: width=${s.imageWidthPx}  height=${s.imageHeightPx}`,
    ``,
    `FACE: center=${fmtPt(s.faceCenterPx)}  width=${fmtNum(s.faceWidthPx)}  chinProxyY=${fmtNum(s.chinProxyYPx)}`,
    `EARS: left=${fmtPt(s.leftEarPx)}  right=${fmtPt(s.rightEarPx)}`,
    ``,
    `SHOULDERS: left=${fmtPt(s.leftShoulderPx)}  right=${fmtPt(s.rightShoulderPx)}`,
    `SHOULDER MIDPOINT: ${fmtPt(s.shoulderMidpointPx)}  width=${fmtNum(s.shoulderWidthPx)}`,
    ``,
    `NECK: center=${fmtPt(s.neckCenterPx)}  attachment=${fmtPt(s.neckAttachmentPx)}`,
    `NECK: width(est)=${fmtNum(s.neckWidthPx)}  confidence=${fmtNum(s.neckConfidence)}  method=${s.neckMethod ?? "null"}`,
    ``,
    `JEWELLERY ASSET: ${s.assetWidthPx}x${s.assetHeightPx}px  alphaBbox=[${s.assetAlphaBbox.map((n) => n.toFixed(1)).join(", ")}]`,
    `JEWELLERY ATTACHMENT (asset space): ${fmtPt(s.assetAttachmentPx)}`,
    ``,
    `TRANSFORM: scale=${s.scaleFactor.toFixed(4)}  rotation=${s.rotationDegrees.toFixed(2)}deg`,
    `FINAL ATTACHMENT (canvas space): ${fmtPt(s.finalAttachmentPx)}`,
    `TRANSFORMED JEWELLERY ATTACHMENT (self-check, must equal FINAL ATTACHMENT exactly): ${fmtPt(s.transformedAssetAttachmentPx)}  diff=${Math.hypot(
      s.transformedAssetAttachmentPx.x - s.finalAttachmentPx.x,
      s.transformedAssetAttachmentPx.y - s.finalAttachmentPx.y
    ).toFixed(3)}px`,
    `FINAL VISIBLE BBOX (canvas space): [${s.finalVisibleBboxPx.map((n) => n.toFixed(1)).join(", ")}]`,
    ``,
    `DEPTH (M6.2 foundation -- relative landmark z, NOT dense depth; see docs/live-ar-realism-architecture.md §5):`,
    `  face nose z=${fmtNum(s.faceNoseZ)}  (FaceLandmarker origin: center of head)`,
    `  shoulders: left z=${fmtNum(s.leftShoulderZ)}  right z=${fmtNum(s.rightShoulderZ)}  delta(left-right)=${fmtNum(s.shoulderDepthDeltaZ)}  (PoseLandmarker origin: hip midpoint)`,
    `  NOTE: face z and shoulder z use DIFFERENT origins -- not directly comparable to each other.`,
    ``,
    `WEAR GEOMETRY (M6.6 -- elliptical neck projection, see neck-projection.ts):`,
    `  neck boundaries: left=${fmtPt(s.leftNeckBoundaryPx)}  right=${fmtPt(s.rightNeckBoundaryPx)}  radius=${fmtNum(s.neckRadiusPx)}`,
    `  yaw asymmetry=${fmtNum(s.yawAsymmetry)}  contact peak fraction=${fmtNum(s.contactPeakFraction)}  horizontal foreshorten=${fmtNum(s.horizontalForeshorten)}`,
    `  contact curve points: ${s.contactCurvePx.length}`,
  ].join("\n");
}

export function computeNecklaceDebugSnapshot(
  face: LiveFaceLandmarks | null,
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number,
  assetGeometry: JewelleryAssetGeometry,
  transform: LiveTransform | null,
  // Diagnostic-only: mirrors whatever fraction the calibration slider is currently
  // previewing, so this readout's NECK line matches what's actually being rendered
  // instead of always recomputing against the shipped constant.
  neckFractionOverride?: number,
  neckHorizontalOffsetOverride?: number,
  wearDebug: WearGeometryDebugInput | null = null
): NecklaceDebugSnapshot | null {
  if (transform === null) return null;

  const bbox = face?.faceBoundingBox ?? null;
  const faceCenterPx = bbox ? { x: ((bbox.xMin + bbox.xMax) / 2) * imageWidthPx, y: ((bbox.yMin + bbox.yMax) / 2) * imageHeightPx } : null;
  const faceWidthPx = bbox ? (bbox.xMax - bbox.xMin) * imageWidthPx : null;
  const chinProxyYPx = bbox ? bbox.yMax * imageHeightPx : null;
  const ears = face ? resolveEarPoints(face.landmarks) : null;
  const leftEarPx = ears ? { x: ears.left.x * imageWidthPx, y: ears.left.y * imageHeightPx } : null;
  const rightEarPx = ears ? { x: ears.right.x * imageWidthPx, y: ears.right.y * imageHeightPx } : null;

  const shoulderLandmarksPresent = pose && pose.landmarks.length > Math.max(LEFT_SHOULDER_IDX, RIGHT_SHOULDER_IDX);
  const leftShoulderPx = shoulderLandmarksPresent
    ? { x: pose!.landmarks[LEFT_SHOULDER_IDX].x * imageWidthPx, y: pose!.landmarks[LEFT_SHOULDER_IDX].y * imageHeightPx }
    : null;
  const rightShoulderPx = shoulderLandmarksPresent
    ? { x: pose!.landmarks[RIGHT_SHOULDER_IDX].x * imageWidthPx, y: pose!.landmarks[RIGHT_SHOULDER_IDX].y * imageHeightPx }
    : null;
  const shoulderMidpointPx =
    leftShoulderPx && rightShoulderPx ? { x: (leftShoulderPx.x + rightShoulderPx.x) / 2, y: (leftShoulderPx.y + rightShoulderPx.y) / 2 } : null;
  const shoulderWidthPx = leftShoulderPx && rightShoulderPx ? Math.abs(rightShoulderPx.x - leftShoulderPx.x) : null;

  // M6.2 depth foundation -- see this file's docstring and depth.ts for the verified
  // z convention and why face z / shoulder z are not directly comparable to each other.
  const faceNoseZ = face ? safeLandmarkZ(face.landmarks[NOSE_TIP_IDX]) : null;
  const leftShoulderZ = shoulderLandmarksPresent ? safeLandmarkZ(pose!.landmarks[LEFT_SHOULDER_IDX]) : null;
  const rightShoulderZ = shoulderLandmarksPresent ? safeLandmarkZ(pose!.landmarks[RIGHT_SHOULDER_IDX]) : null;
  const shoulderDepthDeltaZ = leftShoulderZ !== null && rightShoulderZ !== null ? leftShoulderZ - rightShoulderZ : null;

  const neck = computeNeckReferenceFrame(
    face,
    pose,
    imageWidthPx,
    imageHeightPx,
    neckFractionOverride,
    neckHorizontalOffsetOverride
  );

  const assetAttachmentPx = assetGeometry.anchorPx;
  const transformedAssetAttachmentPx = applyLiveTransformToPoint(transform, assetGeometry.anchorPx);
  const finalVisibleBboxPx = computeTransformedBoundingBox(transform, assetGeometry);

  const surface = neck ? computeNeckSurfaceDebugPoints(neck) : null;
  const contactCurvePx =
    wearDebug?.strips?.map((strip) => applyLiveTransformToPoint(transform, { x: strip.sourceX + strip.sourceWidth / 2, y: strip.dropPx })) ?? [];

  return {
    imageWidthPx,
    imageHeightPx,
    faceCenterPx,
    faceWidthPx,
    chinProxyYPx,
    leftEarPx,
    rightEarPx,
    leftShoulderPx,
    rightShoulderPx,
    shoulderMidpointPx,
    shoulderWidthPx,
    neckCenterPx: neck?.centerPx ?? null,
    neckAttachmentPx: neck?.attachmentPx ?? null,
    neckWidthPx: neck?.widthPx ?? null,
    neckConfidence: neck?.confidence ?? null,
    neckMethod: neck?.method ?? null,
    assetWidthPx: assetGeometry.widthPx,
    assetHeightPx: assetGeometry.heightPx,
    assetAlphaBbox: assetGeometry.alphaBbox,
    assetAttachmentPx,
    scaleFactor: transform.scaleFactor,
    rotationDegrees: transform.rotationDegrees,
    finalAttachmentPx: transform.anchorPx,
    transformedAssetAttachmentPx,
    finalVisibleBboxPx,
    faceNoseZ,
    leftShoulderZ,
    rightShoulderZ,
    shoulderDepthDeltaZ,
    leftNeckBoundaryPx: surface?.leftBoundaryPx ?? null,
    rightNeckBoundaryPx: surface?.rightBoundaryPx ?? null,
    neckRadiusPx: surface?.radiusPx ?? null,
    contactCurvePx,
    yawAsymmetry: wearDebug?.yawAsymmetry ?? null,
    contactPeakFraction: wearDebug?.contactPeakFraction ?? null,
    horizontalForeshorten: wearDebug?.horizontalForeshorten ?? null,
  };
}
