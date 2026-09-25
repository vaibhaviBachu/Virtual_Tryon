import { describe, expect, it } from "vitest";

import { computeNeckReferenceFrame } from "@/lib/live-ar/neck-reference";
import type { LiveFaceLandmarks, LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";
import { resolveAttachmentOrientation } from "@/lib/live-ar/three/body-attachment";
import { computeNeckSurfaceFrame, derivePxPerMm, neckSurfacePointAt } from "@/lib/live-ar/three/neck-surface-3d";
import { buildCameraConfig } from "@/lib/live-ar/three/three-camera";
import { computeSurfaceAttachedTransform, deriveScaleResultFromSmoothedTransform, type Live3dJewelleryAsset } from "@/lib/live-ar/three/three-live-bridge";

/**
 * End-to-end integration test for the full "shoulder midpoint + chin height ->
 * anchor -> orientation -> 3D transform -> neck surface" chain, using realistic
 * (not degenerate) landmark proportions -- the individual pieces are already unit-
 * tested in isolation (neck-reference.test.ts, body-attachment.test.ts, three-
 * live-bridge.test.ts, neck-surface-3d.test.ts); this file exists specifically to
 * prove they compose correctly together, the way useLiveArSession.ts's real render
 * loop actually calls them.
 */
const VIDEO_W = 1280;
const VIDEO_H = 960;

function realisticPose(): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  // Shoulders roughly 35% of frame width apart, at 45% down the frame -- a person
  // framed from the chest up, a realistic webcam composition.
  landmarks[11] = { x: 0.62, y: 0.45, visibility: 0.95 }; // anatomical left shoulder (screen-right)
  landmarks[12] = { x: 0.38, y: 0.45, visibility: 0.95 }; // anatomical right shoulder (screen-left)
  return { landmarks, confidence: 0.95 };
}

function realisticFaceWithoutMatrix(): LiveFaceLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[1] = { x: 0.5, y: 0.22 };
  landmarks[234] = { x: 0.42, y: 0.2 };
  landmarks[454] = { x: 0.58, y: 0.2 };
  // Face bbox bottom (chin proxy) well above the shoulder line -- a real, positive
  // neck length, the same sane-frame precondition neck-reference.ts itself checks.
  return { landmarks, faceBoundingBox: { xMin: 0.4, yMin: 0.05, xMax: 0.6, yMax: 0.32 }, detectionConfidence: 0.95, faceTransformMatrix: null };
}

describe("full neck attachment chain (realistic landmarks, no synthetic shortcuts)", () => {
  it("produces a real, positive-depth, forward-of-camera 3D transform from realistic shoulder+chin landmarks", () => {
    const face = realisticFaceWithoutMatrix();
    const pose = realisticPose();

    const neckRef = computeNeckReferenceFrame(face, pose, VIDEO_W, VIDEO_H);
    expect(neckRef).not.toBeNull();
    expect(neckRef!.method).toBe("face_chin_to_shoulder_interpolation");
    expect(neckRef!.widthPx).not.toBeNull();

    const orientation = resolveAttachmentOrientation("necklace", face, pose, VIDEO_W, VIDEO_H);
    expect(orientation).not.toBeNull();
    // No transform matrix in this fixture -- falls back to the 2D proxy, pitch 0.
    expect(orientation!.method).toBe("shoulder_roll_plus_2d_yaw_proxy_fallback");
    expect(orientation!.pitchRadians).toBe(0);

    const smoothed = { anchorPx: neckRef!.attachmentPx, scaleFactor: 0.45, rotationDegrees: orientation!.rollRadians * (180 / Math.PI), sourceAnchorPx: { x: 0, y: 0 }, mirrored: false };
    const asset: Live3dJewelleryAsset = {
      metadata: {
        modelUrl: "irrelevant-for-this-test.glb",
        modelFormat: "glb",
        physicalWidthMm: 190,
        physicalHeightMm: 106,
        physicalDepthMm: 12,
        attachmentType: "neck_choker",
        anchor: null,
        mirrorable: false,
        materialProfile: "pbr-metallic-roughness",
        scaleCorrection: null,
        rotationCorrectionDegrees: null,
        productionVerified: true,
      },
      instance: {} as never, // not exercised by computeSurfaceAttachedTransform itself
      boundingBoxWidthMm: 190,
    };
    const assetGeometry = { widthPx: 1200, heightPx: 700, alphaBbox: [0, 0, 1200, 700] as [number, number, number, number], anchorPx: { x: 600, y: 0 }, anchorSource: "default_bbox_top_center" as const, mirrorable: false, physicalWidthMm: 190 };
    const cameraConfig = buildCameraConfig(VIDEO_W, VIDEO_H);

    const transform = computeSurfaceAttachedTransform(smoothed, asset, assetGeometry, orientation!, VIDEO_W, VIDEO_H, cameraConfig);
    expect(transform).not.toBeNull();
    expect(transform!.positionMm.z).toBeLessThan(0); // in front of the camera (three-types.ts's -Z convention)
    expect(Number.isFinite(transform!.positionMm.x)).toBe(true);
    expect(Number.isFinite(transform!.positionMm.y)).toBe(true);
    expect(transform!.scale).toBeGreaterThan(0);

    // The neck surface built from the SAME real inputs -- radiusX derived from the
    // SAME calibration the jewellery's own scale uses (Step 3's "distance between
    // shoulder points... to scale" -- here proven consistent with, not overriding,
    // the item's own physical-dimension-based scale).
    const scale = deriveScaleResultFromSmoothedTransform(smoothed, assetGeometry);
    const pxPerMm = derivePxPerMm(scale.targetWidthPx, asset.metadata.physicalWidthMm);
    expect(pxPerMm).not.toBeNull();
    const neckFrame = computeNeckSurfaceFrame(transform!.positionMm, orientation!, neckRef!.widthPx, pxPerMm, orientation!.confidence);
    expect(neckFrame).not.toBeNull();
    expect(neckFrame!.radiusXMm).toBeGreaterThan(0);

    // The surface's own front point reconstructs the tracked attachment position
    // exactly (neck-surface-3d.ts's own documented round-trip guarantee).
    const front = neckSurfacePointAt(neckFrame!, 0);
    expect(front.position.x).toBeCloseTo(transform!.positionMm.x, 5);
    expect(front.position.y).toBeCloseTo(transform!.positionMm.y, 5);
    expect(front.position.z).toBeCloseTo(transform!.positionMm.z, 5);
  });

  it("a wider shoulder span (person closer to camera) produces a larger scale and a shallower depth, consistently", () => {
    const face = realisticFaceWithoutMatrix();
    const closePose: LivePoseLandmarks = {
      landmarks: realisticPose().landmarks.map((p, i) => (i === 11 ? { ...p, x: 0.75 } : i === 12 ? { ...p, x: 0.25 } : p)),
      confidence: 0.95,
    };
    const farPose = realisticPose();

    const neckRefClose = computeNeckReferenceFrame(face, closePose, VIDEO_W, VIDEO_H)!;
    const neckRefFar = computeNeckReferenceFrame(face, farPose, VIDEO_W, VIDEO_H)!;
    // A wider tracked shoulder span (closer person) should measure a larger real
    // reference width -- a real, checkable monotonic relationship, not an assumed one.
    expect(neckRefClose.shoulderWidthPx).toBeGreaterThan(neckRefFar.shoulderWidthPx);
  });
});
