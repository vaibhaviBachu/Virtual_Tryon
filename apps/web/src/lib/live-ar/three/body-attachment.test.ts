import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { resolveAttachmentOrientation, resolveNeckAttachmentOrientation } from "@/lib/live-ar/three/body-attachment";
import type { LiveFaceLandmarks, LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

const IMAGE_W = 800;
const IMAGE_H = 1200;

function matrixDataForYawPitch(yawRadians: number, pitchRadians: number): number[] {
  const euler = new THREE.Euler(pitchRadians, yawRadians, 0, "YXZ");
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  return new THREE.Matrix4().makeRotationFromQuaternion(quaternion).toArray();
}

function faceWithMatrix(yawRadians: number, pitchRadians: number): LiveFaceLandmarks {
  return {
    landmarks: [],
    faceBoundingBox: { xMin: 0.3, yMin: 0.1, xMax: 0.7, yMax: 0.5 },
    detectionConfidence: 0.9,
    faceTransformMatrix: matrixDataForYawPitch(yawRadians, pitchRadians),
  };
}

function faceWithout2dLandmarksForYaw(): LiveFaceLandmarks {
  // No transform matrix -- forces the 2D-proxy fallback path.
  const landmarks: NormalizedPoint[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[1] = { x: 0.5, y: 0.55 };
  landmarks[234] = { x: 0.35, y: 0.5 }; // left edge closer to nose -> head turned toward screen-left
  landmarks[454] = { x: 0.75, y: 0.5 };
  return { landmarks, faceBoundingBox: { xMin: 0.3, yMin: 0.1, xMax: 0.7, yMax: 0.5 }, detectionConfidence: 0.9, faceTransformMatrix: null };
}

function levelPose(): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  landmarks[11] = { x: 0.65, y: 0.6, visibility: 0.9 }; // anatomical left shoulder, screen-right
  landmarks[12] = { x: 0.35, y: 0.6, visibility: 0.9 }; // anatomical right shoulder, screen-left
  return { landmarks, confidence: 0.9 };
}

function tiltedPose(): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  landmarks[11] = { x: 0.65, y: 0.55, visibility: 0.9 };
  landmarks[12] = { x: 0.35, y: 0.65, visibility: 0.9 }; // shoulders tilted
  return { landmarks, confidence: 0.9 };
}

describe("resolveNeckAttachmentOrientation", () => {
  it("uses the real facial transformation matrix when available -- real yaw/pitch, not the 2D proxy", () => {
    const orientation = resolveNeckAttachmentOrientation(faceWithMatrix(0.35, -0.1), levelPose(), IMAGE_W, IMAGE_H);
    expect(orientation.method).toBe("shoulder_roll_plus_real_facial_transform_matrix");
    expect(orientation.yawRadians).toBeCloseTo(0.35, 4);
    expect(orientation.pitchRadians).toBeCloseTo(-0.1, 4);
  });

  it("roll always comes from the real shoulder-line tilt, regardless of head pose source", () => {
    const withMatrix = resolveNeckAttachmentOrientation(faceWithMatrix(0, 0), tiltedPose(), IMAGE_W, IMAGE_H);
    expect(withMatrix.rollRadians).not.toBe(0);

    const level = resolveNeckAttachmentOrientation(faceWithMatrix(0, 0), levelPose(), IMAGE_W, IMAGE_H);
    expect(level.rollRadians).toBeCloseTo(0, 3);
  });

  it("falls back to the 2D yaw proxy with pitch forced to 0 when no transform matrix is available", () => {
    const orientation = resolveNeckAttachmentOrientation(faceWithout2dLandmarksForYaw(), levelPose(), IMAGE_W, IMAGE_H);
    expect(orientation.method).toBe("shoulder_roll_plus_2d_yaw_proxy_fallback");
    expect(orientation.pitchRadians).toBe(0);
  });

  it("degrades gracefully (never throws) with no face and no pose at all", () => {
    expect(() => resolveNeckAttachmentOrientation(null, null, IMAGE_W, IMAGE_H)).not.toThrow();
    const orientation = resolveNeckAttachmentOrientation(null, null, IMAGE_W, IMAGE_H);
    expect(orientation.yawRadians).toBe(0);
    expect(orientation.pitchRadians).toBe(0);
    expect(orientation.rollRadians).toBe(0);
  });
});

describe("resolveAttachmentOrientation (generic registry)", () => {
  it("resolves 'necklace' to the real neck resolver", () => {
    const orientation = resolveAttachmentOrientation("necklace", faceWithMatrix(0.2, 0), levelPose(), IMAGE_W, IMAGE_H);
    expect(orientation).not.toBeNull();
    expect(orientation!.yawRadians).toBeCloseTo(0.2, 4);
  });

  it("resolves 'earrings' to null -- not implemented deeply this phase, never a silent wrong-body-region fallback", () => {
    expect(resolveAttachmentOrientation("earrings", faceWithMatrix(0, 0), levelPose(), IMAGE_W, IMAGE_H)).toBeNull();
  });
});
