import { describe, expect, it } from "vitest";

import { computeNecklaceDebugSnapshot, formatNecklaceDebugSnapshot } from "@/lib/live-ar/debug";
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
    expect(text).not.toContain("[object Object]");
  });
});
