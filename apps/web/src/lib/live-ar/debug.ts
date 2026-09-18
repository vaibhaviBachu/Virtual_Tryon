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
 */
import { resolveEarPoints } from "@/lib/live-ar/geometry";
import { computeNeckReferenceFrame } from "@/lib/live-ar/neck-reference";
import type { JewelleryAssetGeometry, LiveFaceLandmarks, LivePoseLandmarks, LiveTransform, PixelPoint } from "@/lib/live-ar/types";

const LEFT_SHOULDER_IDX = 11;
const RIGHT_SHOULDER_IDX = 12;

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
}

/** Maps a point in the jewellery asset's OWN pixel space through the exact same
 * translate -> rotate -> scale composition `renderer.ts`'s `drawJewelleryOverlay` uses,
 * so the reported "final visible bbox" is what actually gets drawn, not a re-derivation
 * that could silently drift from the real renderer. */
function transformAssetPoint(transform: LiveTransform, assetPx: PixelPoint): PixelPoint {
  const dx = assetPx.x - transform.sourceAnchorPx.x;
  const dy = assetPx.y - transform.sourceAnchorPx.y;
  const scaleX = transform.mirrored ? -transform.scaleFactor : transform.scaleFactor;
  const scaledX = dx * scaleX;
  const scaledY = dy * transform.scaleFactor;
  const theta = (transform.rotationDegrees * Math.PI) / 180;
  const rotatedX = scaledX * Math.cos(theta) - scaledY * Math.sin(theta);
  const rotatedY = scaledX * Math.sin(theta) + scaledY * Math.cos(theta);
  return { x: transform.anchorPx.x + rotatedX, y: transform.anchorPx.y + rotatedY };
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
  neckFractionOverride?: number
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

  const neck = computeNeckReferenceFrame(face, pose, imageWidthPx, imageHeightPx, neckFractionOverride);

  const assetAttachmentPx = assetGeometry.anchorPx;
  const transformedAssetAttachmentPx = transformAssetPoint(transform, assetGeometry.anchorPx);
  const [l, t, r, b] = assetGeometry.alphaBbox;
  const corners = [
    { x: l, y: t },
    { x: r, y: t },
    { x: l, y: b },
    { x: r, y: b },
  ].map((corner) => transformAssetPoint(transform, corner));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const finalVisibleBboxPx: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];

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
  };
}
