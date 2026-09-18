/**
 * Live category readiness -- the continuous-frame analogue of ai/landmarks/readiness.py
 * (Milestone 3's "the same photo can be ready for one category and not another").
 *
 * Deliberately separate from AnchorResult's success/failure (geometry.ts): AnchorResult
 * answers "can I compute a placement at all", using the same FACE_CONFIDENCE_THRESHOLD /
 * EAR_CONFIDENCE_THRESHOLD gates as the photo pipeline. Readiness answers "should the
 * customer trust what's on screen", which needs one extra idea unique to live video: a
 * DEGRADED middle state between a fully confident placement and no placement at all, so
 * the UI can say "hold still" instead of flickering between fully-ready and fully-broken
 * every time a single frame's confidence dips near the threshold. Re-uses
 * NECK_CONFIDENCE_THRESHOLD from constants.ts (mirrors ai/landmarks/readiness.py's own
 * constant) since that check is NOT applied inside computeAnchor's necklace path.
 */
import { computeAnchor, resolveEarConfidence } from "@/lib/live-ar/geometry";
import { EAR_CONFIDENCE_THRESHOLD, FACE_CONFIDENCE_THRESHOLD, NECK_CONFIDENCE_THRESHOLD } from "@/lib/live-ar/constants";
import type { LiveFaceLandmarks, LivePoseLandmarks } from "@/lib/live-ar/types";

export type NecklaceReadinessStatus = "NECKLACE_READY" | "NECKLACE_DEGRADED" | "NECKLACE_NOT_READY";
export type EarringsReadinessStatus = "EARRINGS_READY" | "EARRINGS_DEGRADED" | "EARRINGS_NOT_READY";

export interface ReadinessResult<S extends string> {
  status: S;
  /** Short, lightweight contextual guidance per spec §22 ("Move slightly farther away",
   * "Keep your shoulders visible"...). null when nothing needs to be said. */
  guidance: string | null;
}

/** A confidence right at the READY threshold is exactly the frame where the placement
 * is technically usable but could drop out on the next tiny movement -- widening the
 * DEGRADED band below the hard threshold avoids a placement flickering READY/NOT_READY
 * frame to frame near that boundary. */
const DEGRADED_BAND = 0.1;

export function evaluateNecklaceReadiness(pose: LivePoseLandmarks | null, imageWidthPx: number, imageHeightPx: number): ReadinessResult<NecklaceReadinessStatus> {
  const anchor = computeAnchor("necklace", null, null, pose, imageWidthPx, imageHeightPx);
  if (!anchor.success) {
    return { status: "NECKLACE_NOT_READY", guidance: "Keep your shoulders visible in the frame." };
  }
  const confidence = pose?.confidence ?? 0;
  if (confidence < NECK_CONFIDENCE_THRESHOLD) {
    return { status: "NECKLACE_NOT_READY", guidance: "Move a little closer so your shoulders are clearly visible." };
  }
  if (confidence < NECK_CONFIDENCE_THRESHOLD + DEGRADED_BAND) {
    return { status: "NECKLACE_DEGRADED", guidance: "Hold still for a clearer view of your shoulders." };
  }
  return { status: "NECKLACE_READY", guidance: null };
}

export function evaluateEarringsReadiness(
  side: "left" | "right",
  face: LiveFaceLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number
): ReadinessResult<EarringsReadinessStatus> {
  const anchor = computeAnchor("earrings", side, face, null, imageWidthPx, imageHeightPx);
  if (!anchor.success) {
    if (anchor.errorCode === "FACE_NOT_VISIBLE") {
      return { status: "EARRINGS_NOT_READY", guidance: "Make sure your face is clearly visible to the camera." };
    }
    return {
      status: "EARRINGS_NOT_READY",
      guidance: `Turn slightly toward the camera so your ${side} ear is visible.`,
    };
  }
  if (!face || face.detectionConfidence < FACE_CONFIDENCE_THRESHOLD + DEGRADED_BAND) {
    return { status: "EARRINGS_DEGRADED", guidance: "Hold still for a clearer view of your face." };
  }
  const confidences = resolveEarConfidence(face.landmarks, face.detectionConfidence);
  const earConfidence = confidences ? (side === "left" ? confidences.left : confidences.right) : 0;
  if (earConfidence < EAR_CONFIDENCE_THRESHOLD + DEGRADED_BAND) {
    return { status: "EARRINGS_DEGRADED", guidance: `Turn slightly toward the camera so both ears are visible.` };
  }
  return { status: "EARRINGS_READY", guidance: null };
}
