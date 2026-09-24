import { describe, expect, it } from "vitest";

import {
  buildFinalVisibilityMaskRgba,
  buildOcclusionDebugRgba,
  buildOcclusionEraseRgba,
  computeCategoryDistribution,
  computeHairOverlapReport,
  computeNecklaceOcclusionMask,
  formatCategoryDistribution,
  formatHairOverlapReport,
  hasHairOverlap,
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

  // 2026-09-24 controlled real-device validation Step 6: "Test the four corners and
  // center." A physical point at the video's center/corners must map to the mask's
  // own center/corners proportionally -- confirms there is no hidden offset or
  // asymmetric scaling anywhere in the conversion.
  it("maps the video's four corners and center to the mask's own corresponding corners/center", () => {
    const videoW = 1280;
    const videoH = 960;
    const maskW = 256;
    const maskH = 256;
    const points: [string, number, number][] = [
      ["top-left", 0, 0],
      ["top-right", videoW, 0],
      ["bottom-left", 0, videoH],
      ["bottom-right", videoW, videoH],
      ["center", videoW / 2, videoH / 2],
    ];
    for (const [, px, py] of points) {
      const region = toMaskSpaceRegion([px, py, px, py], py, videoW, videoH, maskW, maskH);
      expect(region.leftPx).toBeCloseTo((px / videoW) * maskW, 6);
      expect(region.topPx).toBeCloseTo((py / videoH) * maskH, 6);
    }
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

describe("buildFinalVisibilityMaskRgba (M6.4 real-device review Step 2)", () => {
  it("is white and fully opaque wherever the jewellery is visible (occlusion=0)", () => {
    const rgba = buildFinalVisibilityMaskRgba(new Uint8ClampedArray([0]));
    expect(Array.from(rgba)).toEqual([255, 255, 255, 255]);
  });

  it("is black and fully opaque wherever the jewellery is occluded (occlusion=255)", () => {
    const rgba = buildFinalVisibilityMaskRgba(new Uint8ClampedArray([255]));
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255]);
  });

  it("is always fully opaque itself, even for a partially-occluded value -- this panel never fades, unlike the erase pattern", () => {
    const rgba = buildFinalVisibilityMaskRgba(new Uint8ClampedArray([128]));
    expect(rgba[3]).toBe(255);
    expect(rgba[0]).toBe(127); // 255-128, gray
  });
});

describe("computeCategoryDistribution / formatCategoryDistribution (M6.4 real-device review Step 7/8)", () => {
  const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 2 };

  it("reports 0 for every category and an empty message when the mask has no data in-region", () => {
    const degenerate: OcclusionRegion = { leftPx: 10, topPx: 10, rightPx: 10, bottomPx: 10, attachmentYPx: 0 };
    const d = computeCategoryDistribution(uniformCategoryMask(HAIR, 4, 4), 4, 4, degenerate);
    expect(d.totalPixels).toBe(0);
    expect(formatCategoryDistribution(d)).toContain("0 mask pixels");
  });

  it("reports 100% hair when the entire region is hair", () => {
    const d = computeCategoryDistribution(uniformCategoryMask(HAIR, 4, 4), 4, 4, region);
    expect(d.totalPixels).toBe(16);
    expect(d.hairPct).toBe(100);
    expect(d.clothesPct).toBe(0);
    expect(d.backgroundPct).toBe(0);
  });

  // 2026-09-24 controlled real-device validation Step 2: "Do not estimate these
  // numbers" -- raw counts must be the real tallies, not back-derived from percentages.
  it("reports real raw pixel counts alongside the percentages", () => {
    const d = computeCategoryDistribution(uniformCategoryMask(HAIR, 4, 4), 4, 4, region);
    expect(d.hairCount).toBe(16);
    expect(d.clothesCount).toBe(0);
    expect(d.backgroundCount).toBe(0);
  });

  it("computes real percentages for a mixed region -- this is what would reveal 'no hair actually detected over the necklace' on a real device", () => {
    // 4x4: 4 hair, 4 clothes, 4 background, 4 face-skin.
    const mask = new Uint8Array([
      HAIR, HAIR, CLOTHES, CLOTHES,
      HAIR, HAIR, CLOTHES, CLOTHES,
      BACKGROUND, BACKGROUND, FACE_SKIN, FACE_SKIN,
      BACKGROUND, BACKGROUND, FACE_SKIN, FACE_SKIN,
    ]);
    const d = computeCategoryDistribution(mask, 4, 4, region);
    expect(d.hairPct).toBeCloseTo(25, 6);
    expect(d.clothesPct).toBeCloseTo(25, 6);
    expect(d.backgroundPct).toBeCloseTo(25, 6);
    expect(d.faceSkinPct).toBeCloseTo(25, 6);
  });

  it("formats a readable, non-empty report with real numbers", () => {
    const d = computeCategoryDistribution(uniformCategoryMask(HAIR, 4, 4), 4, 4, region);
    const text = formatCategoryDistribution(d);
    expect(text).toContain("hair=100.0%");
    expect(text).toContain("16px");
  });
});

// 2026-09-24 controlled real-device validation, Step 4: "Add a clear debug indicator:
// HAIR/NECKLACE OVERLAP: YES / NO."
describe("hasHairOverlap / computeHairOverlapReport / formatHairOverlapReport", () => {
  const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 2 };

  it("hasHairOverlap is false when zero hair pixels are in-region", () => {
    const d = computeCategoryDistribution(uniformCategoryMask(BACKGROUND, 4, 4), 4, 4, region);
    expect(hasHairOverlap(d)).toBe(false);
  });

  it("hasHairOverlap is true when at least one hair pixel is in-region", () => {
    const mask = uniformCategoryMask(BACKGROUND, 4, 4);
    mask[5] = HAIR; // one single hair pixel
    const d = computeCategoryDistribution(mask, 4, 4, region);
    expect(hasHairOverlap(d)).toBe(true);
  });

  it("NO HAIR OVERLAP case: hair away from the necklace -- overlap=false, hairPct=0, necklace fully visible (Step 7's control condition)", () => {
    const categoryMask = uniformCategoryMask(BACKGROUND, 4, 4); // no hair anywhere
    const distribution = computeCategoryDistribution(categoryMask, 4, 4, region);
    const occlusionMask = computeNecklaceOcclusionMask(categoryMask, 4, 4, region);
    const report = computeHairOverlapReport(occlusionMask, 4, 4, region, distribution);
    expect(report.hairNecklaceOverlap).toBe(false);
    expect(report.hairPct).toBe(0);
    expect(report.finalVisiblePct).toBe(100);
  });

  it("HAIR OVERLAP case: hair crossing the necklace -- overlap=true, hairPct>0, visibility reduced accordingly (Step 8's primary acceptance test)", () => {
    // Half the region is hair, half is background.
    const categoryMask = new Uint8Array(16);
    for (let y = 0; y < 4; y++) {
      categoryMask[y * 4 + 0] = HAIR;
      categoryMask[y * 4 + 1] = HAIR;
      categoryMask[y * 4 + 2] = BACKGROUND;
      categoryMask[y * 4 + 3] = BACKGROUND;
    }
    const distribution = computeCategoryDistribution(categoryMask, 4, 4, region);
    const occlusionMask = computeNecklaceOcclusionMask(categoryMask, 4, 4, region);
    const report = computeHairOverlapReport(occlusionMask, 4, 4, region, distribution);
    expect(report.hairNecklaceOverlap).toBe(true);
    expect(report.hairPct).toBeCloseTo(50, 6);
    expect(report.finalVisiblePct).toBeCloseTo(50, 6); // exactly the non-hair half remains visible
  });

  it("degenerate/empty region reports no overlap and full visibility rather than throwing", () => {
    const degenerate: OcclusionRegion = { leftPx: 10, topPx: 10, rightPx: 10, bottomPx: 10, attachmentYPx: 0 };
    const categoryMask = uniformCategoryMask(HAIR, 4, 4);
    const distribution = computeCategoryDistribution(categoryMask, 4, 4, degenerate);
    const occlusionMask = computeNecklaceOcclusionMask(categoryMask, 4, 4, degenerate);
    const report = computeHairOverlapReport(occlusionMask, 4, 4, degenerate, distribution);
    expect(report.hairNecklaceOverlap).toBe(false);
    expect(report.finalVisiblePct).toBe(100);
  });

  it("formatHairOverlapReport renders the exact requested format", () => {
    const text = formatHairOverlapReport({ hairNecklaceOverlap: true, hairPct: 23.7, finalVisiblePct: 82.6 });
    expect(text).toContain("HAIR/NECKLACE OVERLAP: YES");
    expect(text).toContain("Hair in necklace region: 23.7%");
    expect(text).toContain("Final jewellery visibility: 82.6%");
  });

  it("formatHairOverlapReport renders NO when there is no overlap", () => {
    expect(formatHairOverlapReport({ hairNecklaceOverlap: false, hairPct: 0, finalVisiblePct: 100 })).toContain(
      "HAIR/NECKLACE OVERLAP: NO"
    );
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
