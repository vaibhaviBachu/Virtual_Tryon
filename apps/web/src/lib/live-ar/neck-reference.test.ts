import { describe, expect, it } from "vitest";

import { computeNeckReferenceFrame } from "@/lib/live-ar/neck-reference";
import { NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH } from "@/lib/live-ar/constants";
import type { LiveFaceLandmarks, LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

const IMAGE_W = 1000;
const IMAGE_H = 1200;

function poseWithShoulders(leftX = 0.35, rightX = 0.65, y = 0.4, confidence = 0.9): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
  landmarks[11] = { x: leftX, y, visibility: 0.9 };
  landmarks[12] = { x: rightX, y, visibility: 0.9 };
  return { landmarks, confidence };
}

function faceWithChin(yMax: number, xMin = 0.3, xMax = 0.7, detectionConfidence = 0.9): LiveFaceLandmarks {
  return {
    landmarks: [],
    faceBoundingBox: { xMin, yMin: yMax - 0.3, xMax, yMax },
    detectionConfidence,
    faceTransformMatrix: null,
  };
}

describe("computeNeckReferenceFrame", () => {
  it("interpolates between the chin proxy (face bbox bottom) and the shoulder midpoint", () => {
    const pose = poseWithShoulders(0.35, 0.65, 0.4);
    const face = faceWithChin(0.2);
    const frame = computeNeckReferenceFrame(face, pose, IMAGE_W, IMAGE_H);
    expect(frame).not.toBeNull();
    const chinYPx = 0.2 * IMAGE_H;
    const shoulderYPx = 0.4 * IMAGE_H;
    const expectedY = chinYPx + NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH * (shoulderYPx - chinYPx);
    expect(frame!.attachmentPx.y).toBeCloseTo(expectedY, 6);
    expect(frame!.attachmentPx.x).toBeCloseTo(0.5 * IMAGE_W, 6); // shoulder midpoint x
    expect(frame!.method).toBe("face_chin_to_shoulder_interpolation");
    expect(frame!.neckLengthPx).toBeCloseTo(shoulderYPx - chinYPx, 6);
  });

  it("adapts to camera distance: a closer face (bigger bbox, chin further from shoulders in absolute px) moves the attachment point without changing the fraction", () => {
    const pose = poseWithShoulders(0.35, 0.65, 0.4);
    const near = computeNeckReferenceFrame(faceWithChin(0.1), pose, IMAGE_W, IMAGE_H); // longer measured neck
    const far = computeNeckReferenceFrame(faceWithChin(0.3), pose, IMAGE_W, IMAGE_H); // shorter measured neck
    expect(near!.neckLengthPx).toBeGreaterThan(far!.neckLengthPx!);
    // Both still land within their own chin-to-shoulder span at the same fraction.
    const nearFrac = (near!.attachmentPx.y - 0.1 * IMAGE_H) / near!.neckLengthPx!;
    const farFrac = (far!.attachmentPx.y - 0.3 * IMAGE_H) / far!.neckLengthPx!;
    expect(nearFrac).toBeCloseTo(farFrac, 6);
    expect(nearFrac).toBeCloseTo(NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH, 6);
  });

  it("recenters horizontally when the body/shoulders move left or right", () => {
    const face = faceWithChin(0.2);
    const left = computeNeckReferenceFrame(face, poseWithShoulders(0.1, 0.4, 0.4), IMAGE_W, IMAGE_H);
    const right = computeNeckReferenceFrame(face, poseWithShoulders(0.6, 0.9, 0.4), IMAGE_W, IMAGE_H);
    expect(left!.attachmentPx.x).toBeLessThan(right!.attachmentPx.x);
  });

  it("shoulder width alone never changes the attachment point when the chin/shoulder heights are unchanged", () => {
    const face = faceWithChin(0.2);
    const narrow = computeNeckReferenceFrame(face, poseWithShoulders(0.4, 0.6, 0.4), IMAGE_W, IMAGE_H);
    const wide = computeNeckReferenceFrame(face, poseWithShoulders(0.2, 0.8, 0.4), IMAGE_W, IMAGE_H);
    expect(narrow!.attachmentPx.y).toBeCloseTo(wide!.attachmentPx.y, 6);
    expect(wide!.shoulderWidthPx).toBeGreaterThan(narrow!.shoulderWidthPx);
  });

  it("falls back to the shoulder-offset method when there is no face this frame", () => {
    const pose = poseWithShoulders();
    const frame = computeNeckReferenceFrame(null, pose, IMAGE_W, IMAGE_H);
    expect(frame).not.toBeNull();
    expect(frame!.method).toBe("shoulder_offset_fallback_no_face");
    expect(frame!.neckLengthPx).toBeNull();
    expect(frame!.confidence).toBeLessThan(pose.confidence);
  });

  it("falls back when face confidence is too low", () => {
    const pose = poseWithShoulders();
    const face = faceWithChin(0.2, 0.3, 0.7, 0.1); // below FACE_CONFIDENCE_THRESHOLD
    const frame = computeNeckReferenceFrame(face, pose, IMAGE_W, IMAGE_H);
    expect(frame!.method).toBe("shoulder_offset_fallback_no_face");
  });

  it("falls back when the face bounding box is missing", () => {
    const pose = poseWithShoulders();
    const face: LiveFaceLandmarks = { landmarks: [], faceBoundingBox: null, detectionConfidence: 0.9, faceTransformMatrix: null };
    const frame = computeNeckReferenceFrame(face, pose, IMAGE_W, IMAGE_H);
    expect(frame!.method).toBe("shoulder_offset_fallback_no_face");
  });

  it("falls back on a degenerate measurement (chin at or below the shoulder line)", () => {
    const pose = poseWithShoulders(0.35, 0.65, 0.4);
    const face = faceWithChin(0.5); // chin BELOW the shoulder line -- a noisy/invalid detection
    const frame = computeNeckReferenceFrame(face, pose, IMAGE_W, IMAGE_H);
    expect(frame!.method).toBe("shoulder_offset_fallback_no_face");
  });

  it("returns null when there is no pose at all (nothing to anchor to)", () => {
    const frame = computeNeckReferenceFrame(faceWithChin(0.2), null, IMAGE_W, IMAGE_H);
    expect(frame).toBeNull();
  });

  it("confidence combines face and pose confidence when both are available", () => {
    const pose = poseWithShoulders(0.35, 0.65, 0.4, 0.4);
    const face = faceWithChin(0.2, 0.3, 0.7, 0.95);
    const frame = computeNeckReferenceFrame(face, pose, IMAGE_W, IMAGE_H);
    expect(frame!.confidence).toBeCloseTo(0.4, 6); // min(0.95, 0.4)
  });

  // M6.2 depth foundation (docs/live-ar-realism-architecture.md §5/§17): shoulderDepth
  // is passed through from the underlying BodyReferenceFrame unchanged, on BOTH the
  // face-interpolation and the no-face-fallback method.
  describe("shoulderDepth passthrough (M6.2)", () => {
    it("is null when the pose fixture has no z (unchanged default)", () => {
      const pose = poseWithShoulders(0.35, 0.65, 0.4);
      const face = faceWithChin(0.2);
      expect(computeNeckReferenceFrame(face, pose, IMAGE_W, IMAGE_H)!.shoulderDepth).toBeNull();
    });

    it("is passed through on the face_chin_to_shoulder_interpolation method", () => {
      const pose = poseWithShoulders(0.35, 0.65, 0.4);
      pose.landmarks[11] = { ...pose.landmarks[11], z: -0.05 };
      pose.landmarks[12] = { ...pose.landmarks[12], z: 0.02 };
      const frame = computeNeckReferenceFrame(faceWithChin(0.2), pose, IMAGE_W, IMAGE_H);
      expect(frame!.method).toBe("face_chin_to_shoulder_interpolation");
      expect(frame!.shoulderDepth).not.toBeNull();
      expect(frame!.shoulderDepth!.deltaZ).toBeCloseTo(-0.07, 6);
    });

    it("is passed through on the shoulder_offset_fallback_no_face method too", () => {
      const pose = poseWithShoulders();
      pose.landmarks[11] = { ...pose.landmarks[11], z: 0.03 };
      pose.landmarks[12] = { ...pose.landmarks[12], z: -0.04 };
      const frame = computeNeckReferenceFrame(null, pose, IMAGE_W, IMAGE_H);
      expect(frame!.method).toBe("shoulder_offset_fallback_no_face");
      expect(frame!.shoulderDepth).not.toBeNull();
      expect(frame!.shoulderDepth!.deltaZ).toBeCloseTo(0.07, 6);
    });
  });
});
