import { describe, expect, it } from "vitest";

import { computeJewelleryStrips } from "@/lib/live-ar/jewellery-deformation";
import { computeContactPeakFraction, computeHorizontalForeshorten } from "@/lib/live-ar/neck-projection";
import type { NeckCurvatureParams } from "@/lib/live-ar/jewellery-attachment";
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";

function geometry(widthPx: number, heightPx: number, bbox: [number, number, number, number]): JewelleryAssetGeometry {
  return {
    widthPx,
    heightPx,
    alphaBbox: bbox,
    anchorPx: { x: widthPx / 2, y: 0 },
    anchorSource: "default_bbox_top_center",
    mirrorable: false,
    physicalWidthMm: null,
  };
}

const HALF_ANGLE = (60 * Math.PI) / 180;
const curvature: NeckCurvatureParams = { maxDropFraction: 0.1, stripCount: 10, curvatureHalfAngleRadians: HALF_ANGLE };

// Every test in this describe block passes yawAsymmetry=0 -- M6.6's exact
// straight-on-camera, angle-blind case, which reproduces M6.5's original parabola
// byte-for-byte (see neck-projection.test.ts's "is exactly 0.5 at yaw=0" /
// "is exactly 1 at yaw=0" tests, and this file's own "M6.6: yaw responsiveness" block
// below for the NEW angle-dependent behavior).
describe("computeJewelleryStrips (yaw=0, M6.5-equivalent)", () => {
  it("tiles the full image width exactly -- no gap or overlap, regardless of stripCount dividing evenly", () => {
    const g = geometry(333, 100, [0, 0, 333, 100]);
    const { strips } = computeJewelleryStrips(g, { maxDropFraction: 0.1, stripCount: 7, curvatureHalfAngleRadians: HALF_ANGLE }, 0);
    expect(strips).toHaveLength(7);
    let cursor = 0;
    for (const strip of strips) {
      expect(strip.sourceX).toBeCloseTo(cursor, 6);
      cursor += strip.sourceWidth;
    }
    expect(cursor).toBeCloseTo(333, 6);
  });

  it("every strip covers the full image height", () => {
    const g = geometry(200, 150, [0, 0, 200, 150]);
    const { strips } = computeJewelleryStrips(g, curvature, 0);
    for (const strip of strips) expect(strip.sourceHeight).toBe(150);
  });

  it("drop is 0 at the bbox's left/right edges and maximal at its horizontal center (parabolic profile)", () => {
    const widthPx = 1000;
    const g = geometry(widthPx, 100, [0, 0, widthPx, 100]);
    const params: NeckCurvatureParams = { maxDropFraction: 0.1, stripCount: 1000, curvatureHalfAngleRadians: HALF_ANGLE }; // 1 strip/px for exact edge/center sampling
    const { strips } = computeJewelleryStrips(g, params, 0);
    const maxDropPx = params.maxDropFraction * widthPx;

    const leftEdge = strips[0];
    const rightEdge = strips[strips.length - 1];
    const center = strips[Math.floor(strips.length / 2)];

    // Each strip's center sits half a strip-width in from the true mathematical edge
    // (0/widthPx), so it's not EXACTLY zero -- assert it's negligible relative to the
    // max (well under 1%), rather than asserting an exact value a discrete sampling
    // can't actually produce.
    expect(leftEdge.dropPx).toBeLessThan(maxDropPx * 0.01);
    expect(rightEdge.dropPx).toBeLessThan(maxDropPx * 0.01);
    expect(center.dropPx).toBeCloseTo(maxDropPx, 0);
    // Every strip's drop is within [0, maxDropPx] -- the profile never overshoots or
    // goes negative.
    for (const strip of strips) {
      expect(strip.dropPx).toBeGreaterThanOrEqual(-1e-9);
      expect(strip.dropPx).toBeLessThanOrEqual(maxDropPx + 1e-9);
    }
  });

  it("is symmetric around the bbox's horizontal center", () => {
    const widthPx = 400;
    const g = geometry(widthPx, 100, [0, 0, widthPx, 100]);
    const params: NeckCurvatureParams = { maxDropFraction: 0.08, stripCount: 8, curvatureHalfAngleRadians: HALF_ANGLE };
    const { strips } = computeJewelleryStrips(g, params, 0);
    for (let i = 0; i < strips.length; i++) {
      const mirrorIndex = strips.length - 1 - i;
      expect(strips[i].dropPx).toBeCloseTo(strips[mirrorIndex].dropPx, 6);
    }
  });

  it("returns one flat (dropPx=0) strip covering the whole image, and no foreshorten, when maxDropFraction is 0", () => {
    const g = geometry(500, 200, [10, 10, 490, 190]);
    const plan = computeJewelleryStrips(g, { maxDropFraction: 0, stripCount: 20, curvatureHalfAngleRadians: HALF_ANGLE }, 0);
    expect(plan.strips).toEqual([{ sourceX: 0, sourceWidth: 500, sourceHeight: 200, dropPx: 0 }]);
    expect(plan.horizontalForeshorten).toBe(1);
    expect(plan.contactPeakFraction).toBe(0.5);
  });

  it("returns one flat strip when stripCount is 1 or less, even with nonzero maxDropFraction", () => {
    const g = geometry(500, 200, [10, 10, 490, 190]);
    expect(computeJewelleryStrips(g, { maxDropFraction: 0.1, stripCount: 1, curvatureHalfAngleRadians: HALF_ANGLE }, 0).strips).toEqual([
      { sourceX: 0, sourceWidth: 500, sourceHeight: 200, dropPx: 0 },
    ]);
    expect(computeJewelleryStrips(g, { maxDropFraction: 0.1, stripCount: 0, curvatureHalfAngleRadians: HALF_ANGLE }, 0).strips).toEqual([
      { sourceX: 0, sourceWidth: 500, sourceHeight: 200, dropPx: 0 },
    ]);
  });

  it("returns one flat strip for a degenerate (zero-width) alpha bbox rather than dividing by zero", () => {
    const g = geometry(500, 200, [250, 10, 250, 190]); // zero-width bbox
    const { strips } = computeJewelleryStrips(g, curvature, 0);
    expect(strips).toEqual([{ sourceX: 0, sourceWidth: 500, sourceHeight: 200, dropPx: 0 }]);
  });

  it("clamps the drop profile flat outside the alpha bbox (padding regions never diverge or flip sign)", () => {
    // bbox is a narrow strip in the middle of a much wider image -- the padding on
    // either side should just hold the edge (0) drop value, not extrapolate the parabola.
    const widthPx = 300;
    const g = geometry(widthPx, 100, [100, 0, 200, 100]);
    const params: NeckCurvatureParams = { maxDropFraction: 0.1, stripCount: 30, curvatureHalfAngleRadians: HALF_ANGLE };
    const { strips } = computeJewelleryStrips(g, params, 0);
    // Strips fully to the left of the bbox (sourceX + sourceWidth <= 100).
    const leftPadding = strips.filter((s) => s.sourceX + s.sourceWidth <= 100);
    const rightPadding = strips.filter((s) => s.sourceX >= 200);
    expect(leftPadding.length).toBeGreaterThan(0);
    expect(rightPadding.length).toBeGreaterThan(0);
    for (const strip of [...leftPadding, ...rightPadding]) {
      expect(strip.dropPx).toBeCloseTo(0, 5);
    }
  });

  it("scales the max drop with the asset's own measured bbox width, in pixels, for a taller/narrower asset (haaram-shaped)", () => {
    const g = geometry(210, 900, [10, 10, 210, 900]); // bbox width 200
    const params: NeckCurvatureParams = { maxDropFraction: 0.07, stripCount: 21, curvatureHalfAngleRadians: HALF_ANGLE };
    const { strips } = computeJewelleryStrips(g, params, 0);
    const maxObservedDrop = Math.max(...strips.map((s) => s.dropPx));
    expect(maxObservedDrop).toBeCloseTo(0.07 * 200, 0);
  });
});

// M6.6: the NEW yaw-responsive behavior -- everything here is 0 (no-op) when
// yawAsymmetry is 0, per the block above.
describe("computeJewelleryStrips — M6.6 yaw responsiveness", () => {
  it("forwards neck-projection.ts's own computeHorizontalForeshorten result unchanged (single source of truth, not recomputed here)", () => {
    const g = geometry(400, 100, [0, 0, 400, 100]);
    const plan = computeJewelleryStrips(g, curvature, 0.5);
    expect(plan.horizontalForeshorten).toBe(computeHorizontalForeshorten(0.5, curvature.curvatureHalfAngleRadians));
  });

  it("forwards neck-projection.ts's own computeContactPeakFraction result unchanged", () => {
    const g = geometry(400, 100, [0, 0, 400, 100]);
    const plan = computeJewelleryStrips(g, curvature, 0.5);
    expect(plan.contactPeakFraction).toBe(computeContactPeakFraction(0.5));
  });

  it("shifts the drop profile's peak strip away from the sprite's horizontal center for nonzero yaw", () => {
    const widthPx = 1000;
    const g = geometry(widthPx, 100, [0, 0, widthPx, 100]);
    const params: NeckCurvatureParams = { maxDropFraction: 0.1, stripCount: 1000, curvatureHalfAngleRadians: HALF_ANGLE };
    const { strips } = computeJewelleryStrips(g, params, 0.5);
    let peakIndex = 0;
    for (let i = 1; i < strips.length; i++) if (strips[i].dropPx > strips[peakIndex].dropPx) peakIndex = i;
    // At yaw=0 the peak strip would be exactly in the middle (index ~500); a nonzero
    // yaw must move it measurably away from center.
    expect(Math.abs(peakIndex - 500)).toBeGreaterThan(50);
  });

  it("is a pure, deterministic function of its inputs -- same inputs always produce the same plan", () => {
    const g = geometry(400, 100, [0, 0, 400, 100]);
    const plan1 = computeJewelleryStrips(g, curvature, 0.3);
    const plan2 = computeJewelleryStrips(g, curvature, 0.3);
    expect(plan1).toEqual(plan2);
  });

  it("still tiles the full image width exactly under nonzero yaw (yaw only changes drop/foreshorten, never the strip layout itself)", () => {
    const g = geometry(333, 100, [0, 0, 333, 100]);
    const { strips } = computeJewelleryStrips(g, { maxDropFraction: 0.1, stripCount: 7, curvatureHalfAngleRadians: HALF_ANGLE }, -0.7);
    let cursor = 0;
    for (const strip of strips) {
      expect(strip.sourceX).toBeCloseTo(cursor, 6);
      cursor += strip.sourceWidth;
    }
    expect(cursor).toBeCloseTo(333, 6);
  });
});
