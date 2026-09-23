import { describe, expect, it } from "vitest";

import {
  buildOcclusionDebugRgba,
  buildOcclusionEraseRgba,
  computeNecklaceOcclusionMask,
  isMaskStale,
  toMaskSpaceRegion,
  type OcclusionRegion,
} from "@/lib/live-ar/occlusion";

const BACKGROUND = 0;
const HAIR = 1;
const BODY_SKIN = 2;
const FACE_SKIN = 3;
const CLOTHES = 4;
const OTHERS = 5;

function uniformCategoryMask(category: number, width: number, height: number): Uint8Array {
  return new Uint8Array(width * height).fill(category);
}

describe("computeNecklaceOcclusionMask", () => {
  const fullFrameRegion: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 8, bottomPx: 8, attachmentYPx: 3 };

  // 1. Hair pixel occludes jewellery.
  it("hair occludes the necklace anywhere within its region, including well below the attachment point", () => {
    const mask = uniformCategoryMask(HAIR, 8, 8);
    const occlusion = computeNecklaceOcclusionMask(mask, 8, 8, fullFrameRegion);
    // A hair pixel below the attachment (row 6, well past attachmentYPx=3) still occludes.
    expect(occlusion[6 * 8 + 4]).toBe(255);
  });

  // 2. Background pixel does not automatically occlude jewellery.
  it("background never occludes, anywhere in the region", () => {
    const mask = uniformCategoryMask(BACKGROUND, 8, 8);
    const occlusion = computeNecklaceOcclusionMask(mask, 8, 8, fullFrameRegion);
    expect(occlusion.every((v) => v === 0)).toBe(true);
  });

  // 3. Valid body region occludes jewellery according to the documented rule (clothes
  // only at/above the attachment point, never below it).
  it("clothes occludes only at or above the attachment point, never below it", () => {
    const mask = uniformCategoryMask(CLOTHES, 8, 8);
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 8, bottomPx: 8, attachmentYPx: 3 };
    const occlusion = computeNecklaceOcclusionMask(mask, 8, 8, region);
    expect(occlusion[0 * 8 + 4]).toBe(255); // row 0 <= attachmentYPx(3) -- occludes
    expect(occlusion[3 * 8 + 4]).toBe(255); // row 3 == attachmentYPx -- occludes (inclusive)
    expect(occlusion[4 * 8 + 4]).toBe(0); // row 4 > attachmentYPx -- does NOT occlude
    expect(occlusion[7 * 8 + 4]).toBe(0); // deep chest area -- must stay visible
  });

  it("skin (body or face) never occludes", () => {
    for (const category of [BODY_SKIN, FACE_SKIN]) {
      const mask = uniformCategoryMask(category, 8, 8);
      const occlusion = computeNecklaceOcclusionMask(mask, 8, 8, fullFrameRegion);
      expect(occlusion.every((v) => v === 0)).toBe(true);
    }
  });

  it("'others' never occludes", () => {
    const mask = uniformCategoryMask(OTHERS, 8, 8);
    const occlusion = computeNecklaceOcclusionMask(mask, 8, 8, fullFrameRegion);
    expect(occlusion.every((v) => v === 0)).toBe(true);
  });

  // 4. Jewellery remains visible where no occluder exists.
  it("everything outside the region stays non-occluding even if it's classified as hair", () => {
    const mask = uniformCategoryMask(HAIR, 8, 8);
    const region: OcclusionRegion = { leftPx: 2, topPx: 2, rightPx: 5, bottomPx: 5, attachmentYPx: 2 };
    const occlusion = computeNecklaceOcclusionMask(mask, 8, 8, region);
    expect(occlusion[0]).toBe(0); // (0,0) is outside the region
    expect(occlusion[7 * 8 + 7]).toBe(0); // (7,7) is outside the region
    expect(occlusion[3 * 8 + 3]).toBe(255); // (3,3) is inside the region
  });

  // 6. Fully opaque occluder (every pixel in-region occludes).
  it("a region that's entirely hair is entirely occluding", () => {
    const mask = uniformCategoryMask(HAIR, 4, 4);
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 0 };
    const occlusion = computeNecklaceOcclusionMask(mask, 4, 4, region);
    expect(Array.from(occlusion)).toEqual(new Array(16).fill(255));
  });

  // 7. Fully transparent occluder (nothing occludes).
  it("a region that's entirely background is entirely non-occluding", () => {
    const mask = uniformCategoryMask(BACKGROUND, 4, 4);
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 0 };
    const occlusion = computeNecklaceOcclusionMask(mask, 4, 4, region);
    expect(Array.from(occlusion)).toEqual(new Array(16).fill(0));
  });

  // 8. Partial mask -- a realistic mixed region.
  it("handles a realistic mixed region (hair on one side, clothes below the attachment on the other)", () => {
    // 4x4 mask: left column hair, right column clothes, attachment at row 1.
    const mask = new Uint8Array(16);
    for (let y = 0; y < 4; y++) {
      mask[y * 4 + 0] = HAIR;
      mask[y * 4 + 1] = HAIR;
      mask[y * 4 + 2] = CLOTHES;
      mask[y * 4 + 3] = CLOTHES;
    }
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 1 };
    const occlusion = computeNecklaceOcclusionMask(mask, 4, 4, region);
    expect(occlusion[3 * 4 + 0]).toBe(255); // hair, row 3 -- occludes regardless of row
    expect(occlusion[0 * 4 + 2]).toBe(255); // clothes, row 0 <= attachment -- occludes
    expect(occlusion[3 * 4 + 2]).toBe(0); // clothes, row 3 > attachment -- does not occlude
  });

  // 15. Empty segmentation (all-background is the natural "empty" case for this model).
  it("an all-background mask produces zero occlusion anywhere", () => {
    const mask = uniformCategoryMask(BACKGROUND, 4, 4);
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 2 };
    expect(Array.from(computeNecklaceOcclusionMask(mask, 4, 4, region))).toEqual(new Array(16).fill(0));
  });

  // 16. Invalid segmentation -- categoryData shorter than width*height must not throw,
  // and out-of-bounds reads (undefined) must be treated as non-occluding, not crash.
  it("does not throw and treats out-of-bounds category data as non-occluding", () => {
    const shortMask = new Uint8Array(4); // width*height would be 16 -- deliberately too short
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 2 };
    expect(() => computeNecklaceOcclusionMask(shortMask, 4, 4, region)).not.toThrow();
    const occlusion = computeNecklaceOcclusionMask(shortMask, 4, 4, region);
    expect(occlusion[15]).toBe(0); // reads past the short array's end -> undefined -> non-occluding
  });

  it("clips a region that extends past the mask bounds instead of throwing", () => {
    const mask = uniformCategoryMask(HAIR, 4, 4);
    const region: OcclusionRegion = { leftPx: -5, topPx: -5, rightPx: 100, bottomPx: 100, attachmentYPx: 0 };
    expect(() => computeNecklaceOcclusionMask(mask, 4, 4, region)).not.toThrow();
    expect(Array.from(computeNecklaceOcclusionMask(mask, 4, 4, region))).toEqual(new Array(16).fill(255));
  });
});

describe("toMaskSpaceRegion (coordinate conversion)", () => {
  // 9. Mask coordinate conversion.
  it("scales a canvas-space bbox down to the mask's native resolution", () => {
    // video 1280x960 (4:3, matches the mask's own 4:3-equivalent square-ish case),
    // mask 256x256 -- but test with a non-square video to also cover per-axis scaling.
    const region = toMaskSpaceRegion([640, 480, 960, 720], 500, 1280, 960, 256, 256);
    expect(region.leftPx).toBeCloseTo(640 * (256 / 1280), 6);
    expect(region.topPx).toBeCloseTo(480 * (256 / 960), 6);
    expect(region.rightPx).toBeCloseTo(960 * (256 / 1280), 6);
    expect(region.bottomPx).toBeCloseTo(720 * (256 / 960), 6);
    expect(region.attachmentYPx).toBeCloseTo(500 * (256 / 960), 6);
  });

  // 10. Mirroring invariants -- this module works entirely in the same UNMIRRORED
  // space as tracking/geometry (see file docstring); a region on the left side of the
  // frame must map to the left side of the mask, never flipped.
  it("never flips left/right or top/bottom -- pure per-axis scaling, no mirroring", () => {
    const leftSide = toMaskSpaceRegion([0, 0, 100, 100], 50, 1000, 1000, 256, 256);
    const rightSide = toMaskSpaceRegion([900, 0, 1000, 100], 50, 1000, 1000, 256, 256);
    expect(leftSide.leftPx).toBeLessThan(rightSide.leftPx);
    expect(leftSide.rightPx).toBeLessThan(rightSide.rightPx);
  });

  // 17. Different camera/mask aspect ratios -- per-axis scale, not a single uniform
  // factor, so a non-square video against a square mask still maps each axis correctly.
  it("uses independent per-axis scale factors when the video and mask aspect ratios differ", () => {
    // Wide video (1280x720, 16:9) against a square mask (256x256) -- scaleX != scaleY.
    const region = toMaskSpaceRegion([0, 0, 1280, 720], 360, 1280, 720, 256, 256);
    expect(region.rightPx).toBeCloseTo(256, 6); // full width maps to full mask width
    expect(region.bottomPx).toBeCloseTo(256, 6); // full height maps to full mask height
    // The two scale factors genuinely differ for this aspect-ratio mismatch.
    const scaleX = 256 / 1280;
    const scaleY = 256 / 720;
    expect(scaleX).not.toBeCloseTo(scaleY, 3);
    expect(region.attachmentYPx).toBeCloseTo(360 * scaleY, 6);
  });
});

describe("isMaskStale", () => {
  // 11. Stale mask.
  it("is stale when age exceeds the threshold", () => {
    expect(isMaskStale(2500, 2000)).toBe(true);
  });

  it("is stale when there is no mask at all (age is null)", () => {
    expect(isMaskStale(null, 2000)).toBe(true);
  });

  // 12. Fresh mask.
  it("is NOT stale when age is under the threshold", () => {
    expect(isMaskStale(500, 2000)).toBe(false);
  });

  it("treats an age exactly at the threshold as not yet stale (strictly greater-than)", () => {
    expect(isMaskStale(2000, 2000)).toBe(false);
  });
});

describe("buildOcclusionEraseRgba (the real, non-debug erase pattern)", () => {
  it("sets alpha=255 wherever the occlusion mask says occlude, 0 elsewhere", () => {
    const occlusion = new Uint8ClampedArray([0, 255, 255, 0]);
    const rgba = buildOcclusionEraseRgba(occlusion);
    expect(rgba[0 * 4 + 3]).toBe(0);
    expect(rgba[1 * 4 + 3]).toBe(255);
    expect(rgba[2 * 4 + 3]).toBe(255);
    expect(rgba[3 * 4 + 3]).toBe(0);
  });

  it("produces exactly occlusionMask.length * 4 bytes", () => {
    expect(buildOcclusionEraseRgba(new Uint8ClampedArray(9)).length).toBe(36);
  });
});

describe("buildOcclusionDebugRgba", () => {
  it("is fully transparent wherever the occlusion mask is 0", () => {
    const occlusion = new Uint8ClampedArray([0, 0, 0, 0]);
    const rgba = buildOcclusionDebugRgba(occlusion);
    expect(rgba.every((v) => v === 0)).toBe(true);
  });

  it("colors occluding pixels with a distinct, semi-opaque color", () => {
    const occlusion = new Uint8ClampedArray([0, 255, 0, 255]);
    const rgba = buildOcclusionDebugRgba(occlusion);
    expect(rgba[0 * 4 + 3]).toBe(0); // pixel 0: non-occluding -> transparent
    expect(rgba[1 * 4 + 3]).toBeGreaterThan(0); // pixel 1: occluding -> visible
    expect(rgba[3 * 4 + 3]).toBeGreaterThan(0); // pixel 3: occluding -> visible
  });

  it("produces exactly occlusionMask.length * 4 bytes", () => {
    const occlusion = new Uint8ClampedArray(9);
    expect(buildOcclusionDebugRgba(occlusion).length).toBe(36);
  });
});
