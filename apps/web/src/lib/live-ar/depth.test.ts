import { describe, expect, it } from "vitest";

import { compareRelativeDepth, computeShoulderDepthAsymmetry, safeLandmarkZ } from "@/lib/live-ar/depth";
import type { LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

describe("safeLandmarkZ", () => {
  it("returns the z value when it is a finite number", () => {
    expect(safeLandmarkZ({ x: 0.5, y: 0.5, z: -0.12 })).toBe(-0.12);
  });

  it("returns null when z is missing", () => {
    expect(safeLandmarkZ({ x: 0.5, y: 0.5 })).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(safeLandmarkZ({ x: 0.5, y: 0.5, z: NaN })).toBeNull();
  });

  it("returns null for Infinity and -Infinity", () => {
    expect(safeLandmarkZ({ x: 0.5, y: 0.5, z: Infinity })).toBeNull();
    expect(safeLandmarkZ({ x: 0.5, y: 0.5, z: -Infinity })).toBeNull();
  });

  it("returns null for a missing/undefined point", () => {
    expect(safeLandmarkZ(undefined)).toBeNull();
    expect(safeLandmarkZ(null)).toBeNull();
  });
});

describe("compareRelativeDepth", () => {
  // 1. Same z.
  it("reports deltaZ = 0 and targetIsCloser = false for equal z values (a tie is not 'closer')", () => {
    const a: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.2 };
    const b: NormalizedPoint = { x: 0.3, y: 0.4, z: 0.2 };
    const result = compareRelativeDepth(a, b);
    expect(result).not.toBeNull();
    expect(result!.deltaZ).toBe(0);
    expect(result!.targetIsCloser).toBe(false);
  });

  // 2. Target in front of (closer than) reference: smaller z = closer, per the verified
  // MediaPipe convention documented in depth.ts.
  it("reports targetIsCloser = true and a negative deltaZ when the target has a smaller z", () => {
    const reference: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.1 };
    const target: NormalizedPoint = { x: 0.5, y: 0.5, z: -0.15 };
    const result = compareRelativeDepth(reference, target);
    expect(result).not.toBeNull();
    expect(result!.deltaZ).toBeCloseTo(-0.25, 6);
    expect(result!.targetIsCloser).toBe(true);
  });

  // 3. Target behind (farther than) reference: opposite sign.
  it("reports targetIsCloser = false and a positive deltaZ when the target has a larger z", () => {
    const reference: NormalizedPoint = { x: 0.5, y: 0.5, z: -0.1 };
    const target: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.2 };
    const result = compareRelativeDepth(reference, target);
    expect(result).not.toBeNull();
    expect(result!.deltaZ).toBeCloseTo(0.3, 6);
    expect(result!.targetIsCloser).toBe(false);
  });

  // 4. Missing z -> safe/explicit unavailable state, on either side.
  it("returns null when the reference z is missing", () => {
    const reference: NormalizedPoint = { x: 0.5, y: 0.5 };
    const target: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.1 };
    expect(compareRelativeDepth(reference, target)).toBeNull();
  });

  it("returns null when the target z is missing", () => {
    const reference: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.1 };
    const target: NormalizedPoint = { x: 0.5, y: 0.5 };
    expect(compareRelativeDepth(reference, target)).toBeNull();
  });

  // 5. NaN / Infinity -> safe handling.
  it("returns null when either z is NaN or Infinity", () => {
    const finite: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.1 };
    expect(compareRelativeDepth({ x: 0, y: 0, z: NaN }, finite)).toBeNull();
    expect(compareRelativeDepth(finite, { x: 0, y: 0, z: Infinity })).toBeNull();
    expect(compareRelativeDepth({ x: 0, y: 0, z: -Infinity }, finite)).toBeNull();
  });

  // 6. Very small depth difference must not produce unstable output.
  it("stays finite and deterministic for a very small depth difference", () => {
    const reference: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.500000001 };
    const target: NormalizedPoint = { x: 0.5, y: 0.5, z: 0.5 };
    const result = compareRelativeDepth(reference, target);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.deltaZ)).toBe(true);
    expect(result!.targetIsCloser).toBe(true); // target's z is (very slightly) smaller
  });
});

// 7. Different body poses, hand-built fixtures.
function poseWithShoulderZ(leftZ: number | undefined, rightZ: number | undefined): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
  landmarks[11] = { x: 0.65, y: 0.4, z: leftZ, visibility: 0.9 }; // left shoulder (anatomical), larger x
  landmarks[12] = { x: 0.35, y: 0.4, z: rightZ, visibility: 0.9 }; // right shoulder
  return { landmarks, confidence: 0.9 };
}

describe("computeShoulderDepthAsymmetry", () => {
  it("is null without a pose", () => {
    expect(computeShoulderDepthAsymmetry(null)).toBeNull();
  });

  it("is null when the pose has too few landmarks to include both shoulders", () => {
    const pose: LivePoseLandmarks = { landmarks: Array.from({ length: 5 }, () => ({ x: 0.5, y: 0.1 })), confidence: 0.9 };
    expect(computeShoulderDepthAsymmetry(pose)).toBeNull();
  });

  it("is null when either shoulder's z is missing (frontal pose fixtures often omit z entirely)", () => {
    expect(computeShoulderDepthAsymmetry(poseWithShoulderZ(undefined, undefined))).toBeNull();
  });

  it("frontal pose: equal shoulder z -> deltaZ = 0, targetIsCloser = false", () => {
    const result = computeShoulderDepthAsymmetry(poseWithShoulderZ(0.05, 0.05));
    expect(result).not.toBeNull();
    expect(result!.deltaZ).toBe(0);
    expect(result!.targetIsCloser).toBe(false);
  });

  it("slight turn with the left shoulder forward: left shoulder closer (smaller z) is reported as targetIsCloser", () => {
    // reference = right shoulder z, target = left shoulder z (see depth.ts docstring).
    const result = computeShoulderDepthAsymmetry(poseWithShoulderZ(-0.08, 0.03));
    expect(result).not.toBeNull();
    expect(result!.targetIsCloser).toBe(true);
    expect(result!.deltaZ).toBeCloseTo(-0.11, 6);
  });

  it("slight turn with the right shoulder forward: opposite sign", () => {
    const result = computeShoulderDepthAsymmetry(poseWithShoulderZ(0.04, -0.09));
    expect(result).not.toBeNull();
    expect(result!.targetIsCloser).toBe(false);
    expect(result!.deltaZ).toBeCloseTo(0.13, 6);
  });
});
