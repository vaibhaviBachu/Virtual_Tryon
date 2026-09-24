import { describe, expect, it } from "vitest";

import { computeNeckSurfaceDebugPoints } from "@/lib/live-ar/neck-surface";
import type { NeckReferenceFrame } from "@/lib/live-ar/types";

function neckFrame(overrides: Partial<NeckReferenceFrame> = {}): NeckReferenceFrame {
  return {
    attachmentPx: { x: 300, y: 400 },
    centerPx: { x: 300, y: 380 },
    widthPx: 120,
    neckLengthPx: 60,
    shoulderWidthPx: 300,
    confidence: 0.9,
    method: "face_chin_to_shoulder_interpolation",
    shoulderDepth: null,
    ...overrides,
  };
}

describe("computeNeckSurfaceDebugPoints", () => {
  it("derives left/right boundaries symmetrically around the neck center, at the attachment Y", () => {
    const points = computeNeckSurfaceDebugPoints(neckFrame())!;
    expect(points.radiusPx).toBe(60);
    expect(points.centerPx).toEqual({ x: 300, y: 380 });
    expect(points.leftBoundaryPx).toEqual({ x: 240, y: 400 });
    expect(points.rightBoundaryPx).toEqual({ x: 360, y: 400 });
  });

  it("returns null when the neck reference frame has no width estimate (fallback method with no face)", () => {
    expect(computeNeckSurfaceDebugPoints(neckFrame({ widthPx: null }))).toBeNull();
  });

  it("returns null for a degenerate (zero or negative) width rather than a zero-radius result", () => {
    expect(computeNeckSurfaceDebugPoints(neckFrame({ widthPx: 0 }))).toBeNull();
    expect(computeNeckSurfaceDebugPoints(neckFrame({ widthPx: -10 }))).toBeNull();
  });
});
