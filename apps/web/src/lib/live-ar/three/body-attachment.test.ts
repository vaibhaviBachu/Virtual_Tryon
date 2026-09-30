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

/** Phase I: a pose whose shoulders carry real z depth, so `computeBodyYawRadians`
 * (depth.ts) resolves to a real, non-null body yaw -- exercising the NEW primary
 * path, distinct from every fixture above (which omit z entirely, exercising the
 * fallback chain instead). */
function poseWithShoulderDepth(leftZ: number, rightZ: number): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  landmarks[11] = { x: 0.65, y: 0.6, z: leftZ, visibility: 0.9 };
  landmarks[12] = { x: 0.35, y: 0.6, z: rightZ, visibility: 0.9 };
  return { landmarks, confidence: 0.9 };
}

describe("resolveNeckAttachmentOrientation", () => {
  it("falls back to the real facial transformation matrix's own yaw+pitch when the pose has no shoulder depth (body yaw unavailable)", () => {
    const orientation = resolveNeckAttachmentOrientation(faceWithMatrix(0.35, -0.1), levelPose(), IMAGE_W, IMAGE_H);
    expect(orientation.method).toBe("shoulder_roll_plus_real_facial_transform_matrix");
    // Yaw is negated by decomposeFacialTransformMatrix (head-pose.ts's own doc
    // comment has the real-device-motivated, third-party-confirmed evidence);
    // pitch is unaffected.
    expect(orientation.yawRadians).toBeCloseTo(-0.35, 4);
    expect(orientation.pitchRadians).toBeCloseTo(-0.1, 4);
  });

  it("Phase I: prefers BODY yaw (from real shoulder depth) over face yaw when both are available -- pitch still comes from the face", () => {
    // Left shoulder closer to camera (smaller z) than right -- a real body turn.
    const orientation = resolveNeckAttachmentOrientation(faceWithMatrix(0.9, -0.1), poseWithShoulderDepth(-0.08, 0.03), IMAGE_W, IMAGE_H);
    expect(orientation.method).toBe("shoulder_depth_yaw_plus_shoulder_roll_plus_facial_pitch");
    // The face's own yaw (0.9 -> negated to -0.9) is NOT what drives this frame's
    // yaw -- the body signal is a completely different, much smaller magnitude,
    // proving the body path actually took over rather than coincidentally agreeing.
    expect(orientation.yawRadians).not.toBeCloseTo(-0.9, 1);
    expect(Number.isFinite(orientation.yawRadians)).toBe(true);
    // Pitch is unaffected -- still the face's real pitch.
    expect(orientation.pitchRadians).toBeCloseTo(-0.1, 4);
  });

  it("Phase I: body yaw is used even with NO face transform matrix at all (pitch falls back to 0, since there is no face-pose pitch signal to use)", () => {
    const noFace: LiveFaceLandmarks | null = null;
    const orientation = resolveNeckAttachmentOrientation(noFace, poseWithShoulderDepth(-0.08, 0.03), IMAGE_W, IMAGE_H);
    expect(orientation.method).toBe("shoulder_depth_yaw_plus_shoulder_roll_plus_facial_pitch");
    expect(orientation.pitchRadians).toBe(0);
    expect(Number.isFinite(orientation.yawRadians)).toBe(true);
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
    expect(orientation!.yawRadians).toBeCloseTo(-0.2, 4); // negated, see head-pose.ts's own doc comment
  });

  it("resolves 'earrings' to null -- not implemented deeply this phase, never a silent wrong-body-region fallback", () => {
    expect(resolveAttachmentOrientation("earrings", faceWithMatrix(0, 0), levelPose(), IMAGE_W, IMAGE_H)).toBeNull();
  });
});
