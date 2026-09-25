import { describe, expect, it } from "vitest";

import { computeNecklaceDebugSnapshot, formatLive3dDebugInfo, formatNecklaceDebugSnapshot, type Live3dDebugInfoInput, type WearGeometryDebugInput } from "@/lib/live-ar/debug";
import type { JewelleryAssetGeometry, LiveFaceLandmarks, LivePoseLandmarks, LiveTransform, NormalizedPoint } from "@/lib/live-ar/types";

const IMAGE_W = 1000;
const IMAGE_H = 1200;

function pose(): LivePoseLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.1, visibility: 0.9 }));
  landmarks[11] = { x: 0.65, y: 0.4, visibility: 0.9 }; // left shoulder (anatomical), larger x
  landmarks[12] = { x: 0.35, y: 0.4, visibility: 0.9 }; // right shoulder
  return { landmarks, confidence: 0.9 };
}

function face(): LiveFaceLandmarks {
  const landmarks: NormalizedPoint[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[234] = { x: 0.4, y: 0.15 };
  landmarks[454] = { x: 0.6, y: 0.15 };
  return {
    landmarks,
    faceBoundingBox: { xMin: 0.35, yMin: 0.05, xMax: 0.65, yMax: 0.2 },
    detectionConfidence: 0.9,
    faceTransformMatrix: null,
  };
}

function assetGeometry(): JewelleryAssetGeometry {
  return {
    widthPx: 200,
    heightPx: 300,
    alphaBbox: [20, 10, 180, 290],
    anchorPx: { x: 100, y: 10 },
    anchorSource: "default_bbox_top_center",
    mirrorable: false,
    physicalWidthMm: null,
  };
}

describe("computeNecklaceDebugSnapshot", () => {
  it("returns null when there is no transform (nothing was actually rendered this frame)", () => {
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), null);
    expect(snapshot).toBeNull();
  });

  it("reports face, shoulder, and neck reference points consistent with their source landmarks", () => {
    const transform: LiveTransform = {
      anchorPx: { x: 500, y: 500 },
      scaleFactor: 1,
      rotationDegrees: 0,
      sourceAnchorPx: { x: 100, y: 10 },
      mirrored: false,
    };
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.faceCenterPx).toEqual({ x: 0.5 * IMAGE_W, y: 0.125 * IMAGE_H });
    expect(snapshot!.shoulderMidpointPx).toEqual({ x: 0.5 * IMAGE_W, y: 0.4 * IMAGE_H });
    expect(snapshot!.shoulderWidthPx).toBeCloseTo(0.3 * IMAGE_W, 6);
    expect(snapshot!.neckMethod).toBe("face_chin_to_shoulder_interpolation");
    expect(snapshot!.neckAttachmentPx).not.toBeNull();
  });

  it("maps the asset's own attachment point through the transform identically to drawJewelleryOverlay's math (no rotation/mirror case)", () => {
    const transform: LiveTransform = {
      anchorPx: { x: 500, y: 600 },
      scaleFactor: 2,
      rotationDegrees: 0,
      sourceAnchorPx: { x: 100, y: 10 }, // == asset's own attachment point
      mirrored: false,
    };
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform);
    // The final attachment point IS the transform's anchor -- by construction, since
    // that's exactly what drawJewelleryOverlay translates to before drawing.
    expect(snapshot!.finalAttachmentPx).toEqual({ x: 500, y: 600 });
    // The visible bbox corners: alphaBbox = [20,10,180,290], sourceAnchor = (100,10),
    // scale = 2, no rotation -> each corner offsets by (corner - anchor) * 2 from (500,600).
    // Top-left corner (20,10): dx=-80, dy=0 -> scaled (-160, 0) -> final (340, 600).
    // Bottom-right corner (180,290): dx=80, dy=280 -> scaled (160, 560) -> final (660, 1160).
    expect(snapshot!.finalVisibleBboxPx[0]).toBeCloseTo(340, 6); // left
    expect(snapshot!.finalVisibleBboxPx[1]).toBeCloseTo(600, 6); // top
    expect(snapshot!.finalVisibleBboxPx[2]).toBeCloseTo(660, 6); // right
    expect(snapshot!.finalVisibleBboxPx[3]).toBeCloseTo(1160, 6); // bottom
  });

  it("SELF-CHECK: transformedAssetAttachmentPx always exactly equals finalAttachmentPx (mathematically guaranteed -- the asset's own attachment point IS transform.sourceAnchorPx by construction, so transforming it must land exactly on transform.anchorPx). If a real snapshot ever shows these two values differing, that is proof of a live bug (stale closure, mismatched transform object, etc), not a calibration issue.", () => {
    const transform: LiveTransform = {
      anchorPx: { x: 576.4, y: 536.4 },
      scaleFactor: 0.2089,
      rotationDegrees: -1.11,
      sourceAnchorPx: { x: 627.0, y: 0.0 },
      mirrored: false,
    };
    const geometry: JewelleryAssetGeometry = {
      widthPx: 1254,
      heightPx: 1254,
      alphaBbox: [51.0, 0.0, 1202.0, 1176.0],
      anchorPx: { x: 627.0, y: 0.0 },
      anchorSource: "default_bbox_top_center",
      mirrorable: false,
      physicalWidthMm: null,
    };
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, geometry, transform);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.transformedAssetAttachmentPx.x).toBeCloseTo(snapshot!.finalAttachmentPx.x, 6);
    expect(snapshot!.transformedAssetAttachmentPx.y).toBeCloseTo(snapshot!.finalAttachmentPx.y, 6);
  });

  it("falls back gracefully (still returns a snapshot) when there is no face this frame", () => {
    const transform: LiveTransform = {
      anchorPx: { x: 500, y: 500 },
      scaleFactor: 1,
      rotationDegrees: 0,
      sourceAnchorPx: { x: 100, y: 10 },
      mirrored: false,
    };
    const snapshot = computeNecklaceDebugSnapshot(null, pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.faceCenterPx).toBeNull();
    expect(snapshot!.neckMethod).toBe("shoulder_offset_fallback_no_face");
  });
});

// M6.2 depth foundation (docs/live-ar-realism-architecture.md §5/§17).
describe("computeNecklaceDebugSnapshot -- depth fields (M6.2)", () => {
  const transform: LiveTransform = {
    anchorPx: { x: 500, y: 500 },
    scaleFactor: 1,
    rotationDegrees: 0,
    sourceAnchorPx: { x: 100, y: 10 },
    mirrored: false,
  };

  it("reports null depth fields when the fixtures carry no z (the pre-M6.2 default)", () => {
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform);
    expect(snapshot!.faceNoseZ).toBeNull();
    expect(snapshot!.leftShoulderZ).toBeNull();
    expect(snapshot!.rightShoulderZ).toBeNull();
    expect(snapshot!.shoulderDepthDeltaZ).toBeNull();
  });

  it("reports real z values and the shoulder delta when the fixtures carry z", () => {
    const withDepthFace = face();
    withDepthFace.landmarks[1] = { ...withDepthFace.landmarks[1], z: -0.2 }; // nose tip
    const withDepthPose = pose();
    withDepthPose.landmarks[11] = { ...withDepthPose.landmarks[11], z: -0.03 }; // left shoulder
    withDepthPose.landmarks[12] = { ...withDepthPose.landmarks[12], z: 0.05 }; // right shoulder
    const snapshot = computeNecklaceDebugSnapshot(withDepthFace, withDepthPose, IMAGE_W, IMAGE_H, assetGeometry(), transform);
    expect(snapshot!.faceNoseZ).toBeCloseTo(-0.2, 6);
    expect(snapshot!.leftShoulderZ).toBeCloseTo(-0.03, 6);
    expect(snapshot!.rightShoulderZ).toBeCloseTo(0.05, 6);
    expect(snapshot!.shoulderDepthDeltaZ).toBeCloseTo(-0.08, 6);
  });
});

// M6.6 ("Wear Geometry Debug").
describe("computeNecklaceDebugSnapshot -- wear geometry fields (M6.6)", () => {
  const transform: LiveTransform = {
    anchorPx: { x: 500, y: 500 },
    scaleFactor: 1,
    rotationDegrees: 0,
    sourceAnchorPx: { x: 100, y: 10 },
    mirrored: false,
  };

  it("reports null wear-geometry fields when wearDebug isn't passed (byte-for-byte the pre-M6.6 default)", () => {
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform);
    expect(snapshot!.yawAsymmetry).toBeNull();
    expect(snapshot!.contactPeakFraction).toBeNull();
    expect(snapshot!.horizontalForeshorten).toBeNull();
    expect(snapshot!.contactCurvePx).toEqual([]);
  });

  it("reports neck boundaries derived from the SAME neck reference frame already used for placement", () => {
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform);
    expect(snapshot!.neckRadiusPx).not.toBeNull();
    expect(snapshot!.leftNeckBoundaryPx!.x).toBeLessThan(snapshot!.neckCenterPx!.x);
    expect(snapshot!.rightNeckBoundaryPx!.x).toBeGreaterThan(snapshot!.neckCenterPx!.x);
  });

  it("maps each strip's contact point through the exact same transform math as the rest of this snapshot, when wearDebug is provided", () => {
    const wearDebug: WearGeometryDebugInput = {
      strips: [{ sourceX: 90, sourceWidth: 20, sourceHeight: 300, dropPx: 15 }],
      horizontalForeshorten: 0.9,
      contactPeakFraction: 0.5,
      yawAsymmetry: 0.2,
    };
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform, undefined, undefined, wearDebug);
    expect(snapshot!.yawAsymmetry).toBe(0.2);
    expect(snapshot!.contactPeakFraction).toBe(0.5);
    expect(snapshot!.horizontalForeshorten).toBe(0.9);
    expect(snapshot!.contactCurvePx).toHaveLength(1);
    // strip center (100) - sourceAnchorPx.x (100) = 0 dx; dropPx(15) - sourceAnchorPx.y(10) = 5 dy;
    // scale=1, no rotation -> final = anchor + (0, 5) = (500, 505).
    expect(snapshot!.contactCurvePx[0]).toEqual({ x: 500, y: 505 });
  });

  it("reports an empty contact curve when wearDebug.strips is null (no curvature active for this item)", () => {
    const wearDebug: WearGeometryDebugInput = { strips: null, horizontalForeshorten: 1, contactPeakFraction: 0.5, yawAsymmetry: 0 };
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform, undefined, undefined, wearDebug);
    expect(snapshot!.contactCurvePx).toEqual([]);
  });
});

describe("formatNecklaceDebugSnapshot", () => {
  it("produces a readable, non-empty multi-line report with no [object Object] leaks", () => {
    const transform: LiveTransform = {
      anchorPx: { x: 500, y: 500 },
      scaleFactor: 1,
      rotationDegrees: 0,
      sourceAnchorPx: { x: 100, y: 10 },
      mirrored: false,
    };
    const snapshot = computeNecklaceDebugSnapshot(face(), pose(), IMAGE_W, IMAGE_H, assetGeometry(), transform)!;
    const text = formatNecklaceDebugSnapshot(snapshot);
    expect(text).toContain("NECK:");
    expect(text).toContain("JEWELLERY ATTACHMENT");
    expect(text).toContain("FINAL ATTACHMENT");
    expect(text).toContain("TRANSFORMED JEWELLERY ATTACHMENT");
    expect(text).toContain("DEPTH");
    expect(text).toContain("WEAR GEOMETRY");
    expect(text).not.toContain("[object Object]");
  });
});

describe("formatLive3dDebugInfo", () => {
  it("reports 'none' when no 3D/2.5D asset is active this frame (the flat-2D sprite is on screen)", () => {
    expect(formatLive3dDebugInfo(null)).toBe("3D/2.5D: none (flat-2D sprite active)");
  });

  it("reports the representation mode and attachment type for a rendered curved-2.5D frame", () => {
    const info: Live3dDebugInfoInput = {
      status: "rendered",
      jewelleryId: "b68b76b3-55ba-4808-869c-4d8266f7aff7",
      attachmentType: "neck_choker",
      representationMode: "curved-2.5d",
      transform: { positionMm: { x: 1, y: 2, z: -300 }, scale: 0.95 },
      orientation: { yawDegrees: 5, pitchDegrees: -2, rollDegrees: 0, confidence: 0.9, method: "shoulder_roll_plus_real_facial_transform_matrix" },
    };
    const text = formatLive3dDebugInfo(info);
    expect(text).toContain("status=rendered");
    expect(text).toContain("mode=curved-2.5d");
    expect(text).toContain("attachmentType=neck_choker");
    expect(text).toContain("scale=0.950");
    expect(text).not.toContain("[object Object]");
  });

  it("reports a gltf-3d frame with no orientation/transform (e.g. webgl_unavailable) without throwing", () => {
    const info: Live3dDebugInfoInput = {
      status: "webgl_unavailable",
      jewelleryId: "some-id",
      attachmentType: "neck_choker",
      representationMode: "gltf-3d",
      transform: null,
      orientation: null,
    };
    const text = formatLive3dDebugInfo(info);
    expect(text).toContain("mode=gltf-3d");
    expect(text).toContain("status=webgl_unavailable");
  });
});
