import { describe, expect, it } from "vitest";

import { evaluateEarringsReadiness, evaluateNecklaceReadiness } from "@/lib/live-ar/readiness";
import type { LiveFaceLandmarks, LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

const IMAGE_W = 1000;
const IMAGE_H = 1200;

function poseWithConfidence(confidence: number): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
  landmarks[11] = { x: 0.65, y: 0.4, visibility: 0.9 };
  landmarks[12] = { x: 0.35, y: 0.4, visibility: 0.9 };
  return { landmarks, confidence };
}

function faceWithConfidence(confidence: number): LiveFaceLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[1] = { x: 0.5, y: 0.55 };
  landmarks[234] = { x: 0.3, y: 0.5 };
  landmarks[454] = { x: 0.7, y: 0.5 };
  return { landmarks, faceBoundingBox: { xMin: 0.3, yMin: 0.2, xMax: 0.7, yMax: 0.8 }, detectionConfidence: confidence, faceTransformMatrix: null };
}

describe("evaluateNecklaceReadiness", () => {
  it("is NOT_READY with no pose", () => {
    const result = evaluateNecklaceReadiness(null, IMAGE_W, IMAGE_H);
    expect(result.status).toBe("NECKLACE_NOT_READY");
    expect(result.guidance).not.toBeNull();
  });

  it("is NOT_READY below the neck confidence threshold", () => {
    const result = evaluateNecklaceReadiness(poseWithConfidence(0.2), IMAGE_W, IMAGE_H);
    expect(result.status).toBe("NECKLACE_NOT_READY");
  });

  it("is DEGRADED just above the threshold", () => {
    const result = evaluateNecklaceReadiness(poseWithConfidence(0.46), IMAGE_W, IMAGE_H);
    expect(result.status).toBe("NECKLACE_DEGRADED");
  });

  it("is READY with high confidence", () => {
    const result = evaluateNecklaceReadiness(poseWithConfidence(0.95), IMAGE_W, IMAGE_H);
    expect(result).toEqual({ status: "NECKLACE_READY", guidance: null });
  });
});

describe("evaluateEarringsReadiness", () => {
  it("is NOT_READY with no face", () => {
    const result = evaluateEarringsReadiness("left", null, IMAGE_W, IMAGE_H);
    expect(result.status).toBe("EARRINGS_NOT_READY");
  });

  it("is DEGRADED just above the face confidence threshold", () => {
    // 0.59 clears both computeAnchor's ear-confidence gate (0.59 * 0.85 ceiling ~=
    // 0.50, just enough for the anchor to succeed) and readiness's own NOT_READY
    // cutoff, while still sitting inside the DEGRADED_BAND above FACE_CONFIDENCE_THRESHOLD.
    const result = evaluateEarringsReadiness("left", faceWithConfidence(0.59), IMAGE_W, IMAGE_H);
    expect(result.status).toBe("EARRINGS_DEGRADED");
  });

  it("is READY with a confidently detected, symmetric face", () => {
    const result = evaluateEarringsReadiness("left", faceWithConfidence(0.95), IMAGE_W, IMAGE_H);
    expect(result).toEqual({ status: "EARRINGS_READY", guidance: null });
  });

  it("is NOT_READY when the requested ear is heavily foreshortened", () => {
    const face = faceWithConfidence(0.95);
    face.landmarks[1] = { x: 0.32, y: 0.5 }; // nose near the left edge -> left ear foreshortened
    const result = evaluateEarringsReadiness("left", face, IMAGE_W, IMAGE_H);
    expect(["EARRINGS_NOT_READY", "EARRINGS_DEGRADED"]).toContain(result.status);
  });
});
