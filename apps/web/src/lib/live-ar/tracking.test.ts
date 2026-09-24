import { describe, expect, it } from "vitest";

import { toLiveFaceLandmarks, toLivePoseLandmarks } from "@/lib/live-ar/tracking";
import type { FaceLandmarkerResult, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

/**
 * These test only the pure result->our-types conversion functions, which need no real
 * model or camera -- they take a hand-built MediaPipe result object (the shape
 * `detectForVideo` returns) and check the conversion. The actual `createLiveTrackers` /
 * `detectFrameWithTiming` calls that load real models and decode real video frames can only be
 * exercised in a real browser (see this module's docstring and
 * docs/live-ar-verification.md) -- fabricating a fake WASM/model load here would not be
 * an honest test of anything.
 */

describe("toLiveFaceLandmarks", () => {
  it("returns null when no face was found", () => {
    const result = { faceLandmarks: [] } as unknown as FaceLandmarkerResult;
    expect(toLiveFaceLandmarks(result)).toBeNull();
  });

  it("computes the bounding box from the landmark extents", () => {
    const landmarks = [
      { x: 0.3, y: 0.2, z: 0 },
      { x: 0.7, y: 0.8, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
    ];
    const result = { faceLandmarks: [landmarks] } as unknown as FaceLandmarkerResult;
    const face = toLiveFaceLandmarks(result);
    expect(face).not.toBeNull();
    expect(face!.faceBoundingBox).toEqual({ xMin: 0.3, yMin: 0.2, xMax: 0.7, yMax: 0.8 });
    expect(face!.landmarks).toHaveLength(3);
    expect(face!.detectionConfidence).toBe(1.0);
  });
});

describe("toLivePoseLandmarks", () => {
  it("returns null when no pose was found", () => {
    const result = { landmarks: [] } as unknown as PoseLandmarkerResult;
    expect(toLivePoseLandmarks(result)).toBeNull();
  });

  it("returns null when fewer than 13 landmarks are present (no shoulder indices)", () => {
    const result = { landmarks: [Array.from({ length: 5 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))] } as unknown as PoseLandmarkerResult;
    expect(toLivePoseLandmarks(result)).toBeNull();
  });

  it("computes confidence as the average of the two shoulder landmarks' visibility (mirrors ai/landmarks/pose.py)", () => {
    const landmarks = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    landmarks[11] = { x: 0.65, y: 0.4, visibility: 0.8 };
    landmarks[12] = { x: 0.35, y: 0.4, visibility: 0.6 };
    const result = { landmarks: [landmarks] } as unknown as PoseLandmarkerResult;
    const pose = toLivePoseLandmarks(result);
    expect(pose).not.toBeNull();
    expect(pose!.confidence).toBeCloseTo(0.7, 6);
    expect(pose!.landmarks).toHaveLength(13);
  });
});
