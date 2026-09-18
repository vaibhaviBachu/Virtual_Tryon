import { describe, expect, it } from "vitest";

import { computeBodyReferenceFrame } from "@/lib/live-ar/body-reference";
import type { LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

const IMAGE_W = 640;
const IMAGE_H = 480;

function poseWithShoulders(leftX = 0.35, rightX = 0.65, y = 0.4): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
  landmarks[11] = { x: leftX, y, visibility: 0.9 };
  landmarks[12] = { x: rightX, y, visibility: 0.9 };
  return { landmarks, confidence: 0.9 };
}

describe("computeBodyReferenceFrame", () => {
  it("reports real measured shoulder geometry (mirrors ai/tests/test_body_reference.py)", () => {
    const pose = poseWithShoulders(0.35, 0.65, 0.4);
    const frame = computeBodyReferenceFrame(pose, IMAGE_W, IMAGE_H);
    expect(frame).not.toBeNull();
    expect(frame!.leftShoulderPx.x).toBeCloseTo(0.35 * IMAGE_W, 6);
    expect(frame!.rightShoulderPx.x).toBeCloseTo(0.65 * IMAGE_W, 6);
    expect(frame!.shoulderMidpointPx.x).toBeCloseTo(0.5 * IMAGE_W, 6);
    expect(frame!.shoulderMidpointPx.y).toBeCloseTo(0.4 * IMAGE_H, 6);
    expect(frame!.shoulderWidthPx).toBeCloseTo(0.3 * IMAGE_W, 6);
    expect(frame!.verticalBodyDirection).toEqual([0, 1]);
  });

  it("is null without a pose", () => {
    expect(computeBodyReferenceFrame(null, IMAGE_W, IMAGE_H)).toBeNull();
  });

  it("is null when shoulder landmarks are missing", () => {
    const pose: LivePoseLandmarks = {
      landmarks: Array.from({ length: 5 }, () => ({ x: 0.5, y: 0.1 })),
      confidence: 0.9,
    };
    expect(computeBodyReferenceFrame(pose, IMAGE_W, IMAGE_H)).toBeNull();
  });
});
