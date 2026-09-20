/**
 * NeckReferenceFrame — Live-AR-only geometry (no Python mirror; see geometry.ts's file
 * docstring on deliberate, documented divergences from the photo pipeline).
 *
 * MediaPipe never gives us a literal "neck" landmark, so this is an ESTIMATE, explicitly
 * documented as such rather than presented as a directly observed point. It replaces the
 * necklace anchor's previous "shoulder midpoint + fixed offset" formula (which had no way
 * to know how much of the person's actual neck was visible) with an interpolation along a
 * REAL, per-frame MEASURED distance: the bottom of the FaceLandmarker bounding box (a
 * chin proxy -- the face oval's own lowest point, much closer to the true top of the neck
 * than any mouth/lip landmark) down to the PoseLandmarker shoulder midpoint (the base of
 * the visible neck). The attachment point sits most of the way down that measured span,
 * near the shoulders/collarbone -- where a necklace naturally rests -- rather than at the
 * chin/jaw.
 *
 * This adapts correctly to:
 *  - camera distance (both the chin proxy and shoulder line scale together in pixels),
 *  - head tilt / left-right movement (the measurement is taken fresh every frame),
 *  - different individual proportions (no anthropometric averages are needed for the
 *    VERTICAL placement -- only the diagnostic width estimate below uses one).
 *
 * Falls back to the previous shoulder-width-relative offset (a single measurement, lower
 * confidence, explicitly documented as such) when no face is available that frame --
 * necklace tracking must still work with pose alone, just less precisely.
 */
import { computeBodyReferenceFrame } from "@/lib/live-ar/body-reference";
import {
  FACE_CONFIDENCE_THRESHOLD,
  NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION,
  NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH,
  NECK_WIDTH_FRACTION_OF_FACE_WIDTH,
} from "@/lib/live-ar/constants";
import type { LiveFaceLandmarks, LivePoseLandmarks, NeckReferenceFrame, PixelPoint } from "@/lib/live-ar/types";

export function computeNeckReferenceFrame(
  face: LiveFaceLandmarks | null,
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number,
  // Diagnostic-only: lets the debug UI (LiveArStudio's calibration slider) preview a
  // different fraction live, without rebuilding. `undefined` (the default for every
  // real render path) uses the shipped constant. NEVER read from anywhere but that one
  // debug control -- this is not a second, competing source of truth for the fraction.
  fractionOverride?: number,
  // Same diagnostic-only convention as fractionOverride, for the horizontal position --
  // a fraction of shoulder width, added to the shoulder midpoint's x. `undefined` (every
  // real render path) means zero offset (the plain shoulder midpoint, unchanged
  // behavior). See LiveArStudio's "Horizontal offset" slider and
  // neck-horizontal-offset-override.ts.
  horizontalOffsetFraction?: number,
  // Additional vertical nudge, as a fraction of shoulder width, added on top of the
  // fraction-interpolated position above. Used to layer multiple neck items worn at
  // once (e.g. a necklace and a haaram simultaneously) at visibly different depths --
  // see useLiveArSession's necklaceItems handling. Zero for every single-item render
  // path (the default).
  verticalOffsetFraction?: number
): NeckReferenceFrame | null {
  const body = computeBodyReferenceFrame(pose, imageWidthPx, imageHeightPx);
  if (body === null) return null; // no shoulders visible at all -- nothing to anchor to

  const fraction = fractionOverride ?? NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH;
  const horizontalOffsetPx = (horizontalOffsetFraction ?? 0) * body.shoulderWidthPx;
  const verticalOffsetPx = (verticalOffsetFraction ?? 0) * body.shoulderWidthPx;
  const bbox = face?.faceBoundingBox ?? null;
  if (face !== null && bbox !== null && face.detectionConfidence >= FACE_CONFIDENCE_THRESHOLD) {
    const chinProxyYPx = bbox.yMax * imageHeightPx; // bottom of the face oval, approximates the chin
    const faceWidthPx = (bbox.xMax - bbox.xMin) * imageWidthPx;
    const neckLengthPx = body.shoulderMidpointPx.y - chinProxyYPx;

    // A sane frame has the chin above the shoulder line (positive neck length). A noisy
    // detection producing a non-positive value can't be interpolated meaningfully --
    // fall back rather than render a nonsense placement.
    if (neckLengthPx > 0) {
      const attachmentPx: PixelPoint = {
        x: body.shoulderMidpointPx.x + horizontalOffsetPx,
        y: chinProxyYPx + fraction * neckLengthPx + verticalOffsetPx,
      };
      return {
        attachmentPx,
        centerPx: body.shoulderMidpointPx,
        widthPx: faceWidthPx * NECK_WIDTH_FRACTION_OF_FACE_WIDTH,
        neckLengthPx,
        shoulderWidthPx: body.shoulderWidthPx,
        confidence: Math.min(face.detectionConfidence, pose?.confidence ?? 0),
        method: "face_chin_to_shoulder_interpolation",
      };
    }
  }

  // Fallback -- no face this frame, or a degenerate chin/shoulder measurement. Same
  // shoulder-width-relative offset the necklace anchor used before face landmarks were
  // wired in (body.verticalBodyDirection is always (0,1) -- see body-reference.ts's own
  // documented limitation). Confidence is penalized: this is a single anthropometric
  // proxy measurement, not a real per-frame chin-to-shoulder span.
  const [dx, dy] = body.verticalBodyDirection;
  const offsetPx = NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION * body.shoulderWidthPx;
  return {
    attachmentPx: {
      x: body.shoulderMidpointPx.x + dx * offsetPx + horizontalOffsetPx,
      y: body.shoulderMidpointPx.y + dy * offsetPx + verticalOffsetPx,
    },
    centerPx: body.shoulderMidpointPx,
    widthPx: null,
    neckLengthPx: null,
    shoulderWidthPx: body.shoulderWidthPx,
    confidence: (pose?.confidence ?? 0) * 0.6,
    method: "shoulder_offset_fallback_no_face",
  };
}
