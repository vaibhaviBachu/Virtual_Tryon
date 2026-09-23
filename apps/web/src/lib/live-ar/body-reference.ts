/**
 * BodyReferenceFrame — direct TypeScript port of ai/geometry/body_reference.py's
 * `compute_body_reference_frame`. Kept numerically identical (see
 * live-ar-parity.test.ts) since ai/geometry/anchors.py's necklace anchor formula is
 * built directly on top of this frame, and Live AR must compute the same anchor for
 * the same landmarks as the photo pipeline (Milestone 5 spec §3, §13).
 *
 * HONEST LIMITATION (mirrors the Python module's own docstring): MediaPipe Pose does
 * not give this codebase calibrated hip/torso landmarks, so `verticalBodyDirection` is
 * NOT measured from the subject's actual torso lean — it is always (0, 1), the image's
 * own downward axis. See ai/geometry/body_reference.py for the full account of why this
 * is a documented assumption, not a claim of measured body orientation.
 *
 * M6.2 depth foundation (docs/live-ar-realism-architecture.md §5/§17): also reports
 * `shoulderDepth`, the relative MediaPipe z between the two shoulder landmarks -- see
 * depth.ts's file docstring. This has no effect on any of the pixel-space fields above;
 * it is exposed for M6.3+ to build on, not consumed by anything yet.
 */
import { computeShoulderDepthAsymmetry } from "@/lib/live-ar/depth";
import type { BodyReferenceFrame, LivePoseLandmarks, PixelPoint } from "@/lib/live-ar/types";

const LEFT_SHOULDER_IDX = 11;
const RIGHT_SHOULDER_IDX = 12;

export function computeBodyReferenceFrame(
  pose: LivePoseLandmarks | null,
  imageWidthPx: number,
  imageHeightPx: number
): BodyReferenceFrame | null {
  if (pose === null) return null;
  const landmarks = pose.landmarks;
  if (landmarks.length <= Math.max(LEFT_SHOULDER_IDX, RIGHT_SHOULDER_IDX)) return null;

  const left = landmarks[LEFT_SHOULDER_IDX];
  const right = landmarks[RIGHT_SHOULDER_IDX];
  const leftPx: PixelPoint = { x: left.x * imageWidthPx, y: left.y * imageHeightPx };
  const rightPx: PixelPoint = { x: right.x * imageWidthPx, y: right.y * imageHeightPx };
  const midpointPx: PixelPoint = {
    x: (leftPx.x + rightPx.x) / 2,
    y: (leftPx.y + rightPx.y) / 2,
  };
  const shoulderWidthPx = Math.abs(rightPx.x - leftPx.x);

  return {
    leftShoulderPx: leftPx,
    rightShoulderPx: rightPx,
    shoulderMidpointPx: midpointPx,
    shoulderWidthPx,
    verticalBodyDirection: [0, 1] as const,
    shoulderDepth: computeShoulderDepthAsymmetry(pose),
  };
}
