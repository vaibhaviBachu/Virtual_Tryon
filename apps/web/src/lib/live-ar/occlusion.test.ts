import { describe, expect, it } from "vitest";

import {
  applyJewelleryAlphaToOcclusionMask,
  applyRenderedAlphaToOcclusionMask,
  buildFinalVisibilityMaskRgba,
  clipRegionToMask,
  computeAlphaDownscaleSourceRect,
  buildJewelleryAlphaDebugRgba,
  buildOcclusionDebugRgba,
  buildOcclusionEraseRgba,
  computeCategoryDistribution,
  computeHairOverlapReport,
  computeJewelleryAlphaOcclusionReport,
  computeNecklaceOcclusionMask,
  formatCategoryDistribution,
  formatHairOverlapReport,
  formatJewelleryAlphaOcclusionReport,
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

// Extracted as one shared implementation (2026-09-24) after this exact clip logic was
// found duplicated in five different functions in this file.
describe("clipRegionToMask", () => {
  it("floors the top-left and ceils the bottom-right, clamped to the mask bounds", () => {
    const clip = clipRegionToMask({ leftPx: 1.2, topPx: 1.9, rightPx: 3.1, bottomPx: 3.9, attachmentYPx: 0 }, 10, 10);
    expect(clip).toEqual({ left: 1, top: 1, right: 4, bottom: 4, width: 3, height: 3 });
  });

  it("clamps to the mask's own bounds when the region extends past them", () => {
    const clip = clipRegionToMask({ leftPx: -5, topPx: -5, rightPx: 100, bottomPx: 100, attachmentYPx: 0 }, 10, 10);
    expect(clip).toEqual({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 });
  });

  it("reports zero width/height (not negative) for a fully out-of-bounds region", () => {
    const clip = clipRegionToMask({ leftPx: 50, topPx: 50, rightPx: 60, bottomPx: 60, attachmentYPx: 0 }, 10, 10);
    expect(clip.width).toBe(0);
    expect(clip.height).toBe(0);
  });
});

// 2026-09-24 controlled real-device validation Step 5/6/12: the coordinate math that
// keeps the jewellery's own alpha aligned under any transform. Pure -- see
// occlusion-pixel.test.ts for the end-to-end real-pixel confirmation of the same
// scale/rotation/translation cases using the real Canvas 2D pipeline.
describe("computeAlphaDownscaleSourceRect", () => {
  it("maps the unclipped region back to exactly (0,0)-sized-to-bbox when nothing was clipped", () => {
    // video 1000x1000, mask 100x100 -> scale 0.1 on each axis. A bbox at canvas
    // (200,300)-(400,500) (200x200) maps to region (20,30)-(40,50) in mask space,
    // which is NOT clipped (fully inside [0,100)).
    const region: OcclusionRegion = { leftPx: 20, topPx: 30, rightPx: 40, bottomPx: 50, attachmentYPx: 0 };
    const clip = clipRegionToMask(region, 100, 100);
    const rect = computeAlphaDownscaleSourceRect(region, clip, 1000, 1000, 100, 100);
    // No clipping occurred, so the source rect must be exactly the bbox's own local
    // (0,0)-sized-to-(200,200) span -- i.e. sx=sy=0, sw=sh=200 (bboxWidthPx/HeightPx).
    expect(rect.sx).toBeCloseTo(0, 6);
    expect(rect.sy).toBeCloseTo(0, 6);
    expect(rect.sw).toBeCloseTo(200, 6);
    expect(rect.sh).toBeCloseTo(200, 6);
  });

  it("skips the off-frame portion of the local canvas when the bbox is partially clipped on the left/top", () => {
    // Bbox at canvas (-50, -50)-(150, 150) (200x200), video 1000x1000, mask 100x100
    // (scale 0.1). Unclipped region would be (-5,-5)-(15,15); clipped to (0,0)-(15,15).
    const region: OcclusionRegion = { leftPx: -5, topPx: -5, rightPx: 15, bottomPx: 15, attachmentYPx: 0 };
    const clip = clipRegionToMask(region, 100, 100);
    const rect = computeAlphaDownscaleSourceRect(region, clip, 1000, 1000, 100, 100);
    // clip.left(0) - region.leftPx(-5) = 5 mask px = 50 local (video-space) px skipped.
    expect(rect.sx).toBeCloseTo(50, 6);
    expect(rect.sy).toBeCloseTo(50, 6);
    expect(rect.sw).toBeCloseTo(150, 6); // clip.width(15) / scale(0.1)
    expect(rect.sh).toBeCloseTo(150, 6);
  });

  it("uses independent per-axis scale factors, matching toMaskSpaceRegion's own convention", () => {
    // Non-square video (1280x720) against a square mask (256x256) -- scaleX != scaleY.
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 100, bottomPx: 50, attachmentYPx: 0 };
    const clip = clipRegionToMask(region, 256, 256);
    const rect = computeAlphaDownscaleSourceRect(region, clip, 1280, 720, 256, 256);
    const scaleX = 256 / 1280;
    const scaleY = 256 / 720;
    expect(rect.sw).toBeCloseTo(100 / scaleX, 6);
    expect(rect.sh).toBeCloseTo(50 / scaleY, 6);
    expect(scaleX).not.toBeCloseTo(scaleY, 3);
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

// 2026-09-24 controlled validation, Step 1-4/12: the central correction -- occlusion
// must require the jewellery's OWN real alpha to be present, not just "somewhere inside
// the bounding rectangle." All fixtures below use a 6x6 mask region [0,0)-[6,6) with
// the jewellery's REAL alpha occupying only a small block inside that region (e.g.
// (2,2)-(4,4)), leaving a deliberately large transparent gap within the same bounding
// box -- exactly the shape of the real-device finding (a necklace asset has large
// transparent areas inside its own bounding rectangle).
describe("applyJewelleryAlphaToOcclusionMask (Step 4's core correction)", () => {
  const REGION_SIZE = 6;
  const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: REGION_SIZE, bottomPx: REGION_SIZE, attachmentYPx: 3 };

  // Jewellery alpha present only at (2,2), (3,2), (2,3), (3,3) -- a 2x2 block, fully
  // opaque. Everywhere else in the 6x6 region is transparent (alpha 0).
  function jewelleryAlphaBlock(): Uint8ClampedArray {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    for (const y of [2, 3]) {
      for (const x of [2, 3]) alpha[y * REGION_SIZE + x] = 255;
    }
    return alpha;
  }

  // 1. Hair inside bounding box but outside jewellery alpha -> zero jewellery occlusion.
  it("hair filling the whole bounding box EXCEPT the jewellery's own alpha -> zero occlusion", () => {
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE);
    // The jewellery's own footprint is classified background (no hair there at all).
    for (const y of [2, 3]) for (const x of [2, 3]) categoryData[y * REGION_SIZE + x] = BACKGROUND;
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, jewelleryAlphaBlock());
    expect(refined.every((v) => v === 0)).toBe(true);
  });

  // 2. Hair directly overlapping jewellery alpha -> exact overlapping pixels occluded.
  it("hair exactly at the jewellery's own alpha block -> exactly those pixels occlude, nothing else", () => {
    const categoryData = uniformCategoryMask(BACKGROUND, REGION_SIZE, REGION_SIZE);
    for (const y of [2, 3]) for (const x of [2, 3]) categoryData[y * REGION_SIZE + x] = HAIR;
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, jewelleryAlphaBlock());
    for (const y of [2, 3]) for (const x of [2, 3]) expect(refined[y * REGION_SIZE + x]).toBe(255);
    expect(Array.from(refined).filter((v) => v === 255)).toHaveLength(4);
  });

  // 3. Hair partially overlapping jewellery -> only overlapping pixels occluded.
  it("hair covering half the jewellery block and extending into transparent space -> only the overlapping half occludes", () => {
    const categoryData = uniformCategoryMask(BACKGROUND, REGION_SIZE, REGION_SIZE);
    // Hair covers column x=2 (both jewellery rows) AND spills into transparent x=0,1.
    for (const y of [2, 3]) {
      categoryData[y * REGION_SIZE + 0] = HAIR;
      categoryData[y * REGION_SIZE + 1] = HAIR;
      categoryData[y * REGION_SIZE + 2] = HAIR;
    }
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, jewelleryAlphaBlock());
    expect(refined[2 * REGION_SIZE + 2]).toBe(255); // overlaps jewellery -> occludes
    expect(refined[3 * REGION_SIZE + 2]).toBe(255);
    expect(refined[2 * REGION_SIZE + 3]).toBe(0); // jewellery pixel, but no hair here
    expect(refined[2 * REGION_SIZE + 0]).toBe(0); // hair, but no jewellery here (transparent)
    expect(refined[2 * REGION_SIZE + 1]).toBe(0);
  });

  // 4. Hair completely covering a jewellery section -> that section hidden.
  it("hair completely covering the jewellery block -> the whole block occludes", () => {
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, jewelleryAlphaBlock());
    for (const y of [2, 3]) for (const x of [2, 3]) expect(refined[y * REGION_SIZE + x]).toBe(255);
  });

  // 5. Transparent jewellery pixels -> remain transparent and irrelevant to occlusion.
  it("a fully-hair category mask with an all-transparent jewellery alpha (nothing rendered there at all) -> zero occlusion everywhere", () => {
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const noAlpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE); // all zero
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, noAlpha);
    expect(refined.every((v) => v === 0)).toBe(true);
  });

  // 6. Anti-aliased jewellery edge -> alpha preserved appropriately (threshold behavior).
  it("respects the alpha threshold for partially-transparent (anti-aliased) edge pixels", () => {
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const edgeAlpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    edgeAlpha[2 * REGION_SIZE + 2] = 5; // below default threshold (10) -- treated as "no jewellery"
    edgeAlpha[2 * REGION_SIZE + 3] = 128; // well above threshold -- treated as real jewellery
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, edgeAlpha);
    expect(refined[2 * REGION_SIZE + 2]).toBe(0);
    expect(refined[2 * REGION_SIZE + 3]).toBe(255);
  });

  // 7. Clothing overlapping jewellery -> only actual jewellery pixels affected, and only
  // above the attachment point (the pre-existing rule, still respected).
  it("clothing over the jewellery block occludes only the portion at/above the attachment point", () => {
    // Move the jewellery alpha block to straddle the attachment line: rows 2 (above,
    // attachmentYPx=3) and 4 (below).
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    alpha[2 * REGION_SIZE + 2] = 255; // row 2 <= attachmentYPx(3)
    alpha[4 * REGION_SIZE + 2] = 255; // row 4 > attachmentYPx(3)
    const categoryData = uniformCategoryMask(CLOTHES, REGION_SIZE, REGION_SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, alpha);
    expect(refined[2 * REGION_SIZE + 2]).toBe(255); // above attachment -- occludes
    expect(refined[4 * REGION_SIZE + 2]).toBe(0); // below attachment -- never occludes, even with real jewellery alpha there
  });

  // 8. Background -> never occludes, even where jewellery alpha is fully present.
  it("background never occludes, even directly over the jewellery's own alpha", () => {
    const categoryData = uniformCategoryMask(BACKGROUND, REGION_SIZE, REGION_SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, jewelleryAlphaBlock());
    expect(refined.every((v) => v === 0)).toBe(true);
  });

  // 9. Skin -> retains current (never-occludes) behavior, even directly over jewellery alpha.
  it("body-skin and face-skin never occlude, even directly over the jewellery's own alpha", () => {
    for (const category of [BODY_SKIN, FACE_SKIN]) {
      const categoryData = uniformCategoryMask(category, REGION_SIZE, REGION_SIZE);
      const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
      const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, jewelleryAlphaBlock());
      expect(refined.every((v) => v === 0)).toBe(true);
    }
  });

  it("never ADDS occlusion beyond what the category rule proposed -- pure AND, never OR", () => {
    // Category rule says nothing occludes (all background); alpha is fully present
    // everywhere. Refinement must still show zero occlusion.
    const categoryData = uniformCategoryMask(BACKGROUND, REGION_SIZE, REGION_SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const fullAlpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE).fill(255);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, fullAlpha);
    expect(refined.every((v) => v === 0)).toBe(true);
  });
});

describe("applyRenderedAlphaToOcclusionMask (Phase G — the 3D-render counterpart, full-frame, no region needed)", () => {
  const SIZE = 6;
  const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: SIZE, bottomPx: SIZE, attachmentYPx: 3 };

  function renderedAlphaBlock(): Uint8ClampedArray {
    const alpha = new Uint8ClampedArray(SIZE * SIZE);
    for (const y of [2, 3]) for (const x of [2, 3]) alpha[y * SIZE + x] = 255;
    return alpha;
  }

  it("hair filling the whole mask EXCEPT the 3D render's own alpha -> zero occlusion", () => {
    const categoryData = uniformCategoryMask(HAIR, SIZE, SIZE);
    for (const y of [2, 3]) for (const x of [2, 3]) categoryData[y * SIZE + x] = BACKGROUND;
    const categoryMask = computeNecklaceOcclusionMask(categoryData, SIZE, SIZE, region);
    const refined = applyRenderedAlphaToOcclusionMask(categoryMask, renderedAlphaBlock());
    expect(refined.every((v) => v === 0)).toBe(true);
  });

  it("hair exactly overlapping the rendered alpha -> exactly those pixels occlude", () => {
    const categoryData = uniformCategoryMask(BACKGROUND, SIZE, SIZE);
    for (const y of [2, 3]) for (const x of [2, 3]) categoryData[y * SIZE + x] = HAIR;
    const categoryMask = computeNecklaceOcclusionMask(categoryData, SIZE, SIZE, region);
    const refined = applyRenderedAlphaToOcclusionMask(categoryMask, renderedAlphaBlock());
    for (const y of [2, 3]) for (const x of [2, 3]) expect(refined[y * SIZE + x]).toBe(255);
    expect(Array.from(refined).filter((v) => v === 255)).toHaveLength(4);
  });

  it("never occludes where the category rule itself says no (a category never adds occlusion the base mask didn't have)", () => {
    const categoryData = uniformCategoryMask(BACKGROUND, SIZE, SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, SIZE, SIZE, region);
    const fullAlpha = new Uint8ClampedArray(SIZE * SIZE).fill(255);
    const refined = applyRenderedAlphaToOcclusionMask(categoryMask, fullAlpha);
    expect(refined.every((v) => v === 0)).toBe(true);
  });

  it("respects a custom alpha threshold", () => {
    const categoryData = uniformCategoryMask(HAIR, SIZE, SIZE);
    const categoryMask = computeNecklaceOcclusionMask(categoryData, SIZE, SIZE, region);
    const faintAlpha = new Uint8ClampedArray(SIZE * SIZE).fill(5);
    expect(applyRenderedAlphaToOcclusionMask(categoryMask, faintAlpha, 10).every((v) => v === 0)).toBe(true);
    expect(applyRenderedAlphaToOcclusionMask(categoryMask, faintAlpha, 1).every((v) => v === 255)).toBe(true);
  });
});

describe("computeJewelleryAlphaOcclusionReport / formatJewelleryAlphaOcclusionReport (Step 8)", () => {
  const REGION_SIZE = 6;
  const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: REGION_SIZE, bottomPx: REGION_SIZE, attachmentYPx: 3 };

  it("reports the correct denominator: jewellery pixel count, NOT bounding-box pixel count", () => {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    for (const y of [2, 3]) for (const x of [2, 3]) alpha[y * REGION_SIZE + x] = 255; // 4 real jewellery px
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE); // hair everywhere (36 px)
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, alpha);
    const report = computeJewelleryAlphaOcclusionReport(categoryData, refined, REGION_SIZE, REGION_SIZE, region, alpha);
    expect(report.jewelleryPixelCount).toBe(4); // NOT 36
    expect(report.hairOverJewelleryPixelCount).toBe(4);
    expect(report.hairOverJewelleryPct).toBe(100);
    expect(report.finalVisiblePixelCount).toBe(0);
    expect(report.finalVisibilityPct).toBe(0);
  });

  it("matches the exact real-device scenario that prompted this correction: hair beside (not on) the jewellery", () => {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    for (const y of [2, 3]) for (const x of [2, 3]) alpha[y * REGION_SIZE + x] = 255;
    const categoryData = uniformCategoryMask(BACKGROUND, REGION_SIZE, REGION_SIZE);
    // Hair fills the region EXCEPT the jewellery's own footprint -- "beside," not "on."
    for (let i = 0; i < categoryData.length; i++) if (categoryData[i] === BACKGROUND) categoryData[i] = HAIR;
    for (const y of [2, 3]) for (const x of [2, 3]) categoryData[y * REGION_SIZE + x] = BACKGROUND;
    const categoryMask = computeNecklaceOcclusionMask(categoryData, REGION_SIZE, REGION_SIZE, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, REGION_SIZE, REGION_SIZE, region, alpha);
    const report = computeJewelleryAlphaOcclusionReport(categoryData, refined, REGION_SIZE, REGION_SIZE, region, alpha);
    // The bounding-box-only metric would have reported ~89% hair (32/36); the corrected
    // metric reports 0% hair actually over the jewellery, and full visibility.
    expect(report.hairOverJewelleryPct).toBe(0);
    expect(report.finalVisibilityPct).toBe(100);
  });

  it("degenerate/empty region reports zero jewellery pixels rather than throwing", () => {
    const degenerate: OcclusionRegion = { leftPx: 10, topPx: 10, rightPx: 10, bottomPx: 10, attachmentYPx: 0 };
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE);
    const refined = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    const report = computeJewelleryAlphaOcclusionReport(
      categoryData,
      refined,
      REGION_SIZE,
      REGION_SIZE,
      degenerate,
      new Uint8ClampedArray(0)
    );
    expect(report.jewelleryPixelCount).toBe(0);
    expect(report.finalVisibilityPct).toBe(100);
  });

  it("formatJewelleryAlphaOcclusionReport shows the bounding-box, hair, clothes, and final-visibility metrics side by side", () => {
    const report = {
      jewelleryPixelCount: 4,
      hairOverJewelleryPixelCount: 1,
      hairOverJewelleryPct: 25,
      clothesOverJewelleryPixelCount: 2,
      clothesOverJewelleryPct: 50,
      finalVisiblePixelCount: 3,
      finalVisibilityPct: 75,
    };
    const text = formatJewelleryAlphaOcclusionReport(24.7, report);
    expect(text).toContain("bounding box: hair=24.7%");
    expect(text).toContain("(4px)");
    expect(text).toContain("hair-over-jewellery=25.0% (1px)");
    expect(text).toContain("clothes-over-jewellery=50.0% (2px)");
    expect(text).toContain("Final jewellery visible px=3 (75.0%)");
  });

  // 2026-09-24, round 2: "Clothing-over-jewellery: XX.X%" -- a raw diagnostic,
  // deliberately NOT respecting the attachment-line rule (that rule still governs
  // actual occlusion; this metric exists to show clothing IS detected there even when
  // it correctly doesn't occlude).
  it("reports clothes-over-jewellery independently of the attachment-line occlusion rule", () => {
    const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: 4, bottomPx: 4, attachmentYPx: 0 }; // attachment at the very top
    const alpha = new Uint8ClampedArray(16).fill(255); // jewellery alpha everywhere
    const categoryData = uniformCategoryMask(CLOTHES, 4, 4); // clothes everywhere
    const categoryMask = computeNecklaceOcclusionMask(categoryData, 4, 4, region);
    const refined = applyJewelleryAlphaToOcclusionMask(categoryMask, 4, 4, region, alpha);
    const report = computeJewelleryAlphaOcclusionReport(categoryData, refined, 4, 4, region, alpha);
    // Every row except row 0 is below the attachment line, so occlusion only applies
    // to 4 of the 16 pixels -- but ALL 16 are still reported as clothes-over-jewellery.
    expect(report.clothesOverJewelleryPixelCount).toBe(16);
    expect(report.clothesOverJewelleryPct).toBe(100);
    expect(report.finalVisiblePixelCount).toBe(12); // 16 - 4 occluded (row 0 only)
  });
});

describe("buildJewelleryAlphaDebugRgba (Step 9)", () => {
  const REGION_SIZE = 4;
  const region: OcclusionRegion = { leftPx: 0, topPx: 0, rightPx: REGION_SIZE, bottomPx: REGION_SIZE, attachmentYPx: 2 };

  it("is black wherever jewellery alpha is absent, regardless of category", () => {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE); // all transparent
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE);
    // Occluded everywhere: proves alpha-absence overrides occlusion state, not just coincides with it.
    const refinedOcclusionMask = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE).fill(255);
    const rgba = buildJewelleryAlphaDebugRgba(categoryData, refinedOcclusionMask, REGION_SIZE, REGION_SIZE, region, alpha);
    for (let i = 0; i < REGION_SIZE * REGION_SIZE; i++) {
      expect([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]]).toEqual([0, 0, 0, 255]);
    }
  });

  it("is green where jewellery alpha is present and nothing occludes", () => {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE).fill(255);
    const categoryData = uniformCategoryMask(BACKGROUND, REGION_SIZE, REGION_SIZE);
    const refinedOcclusionMask = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE); // 0 = visible everywhere
    const rgba = buildJewelleryAlphaDebugRgba(categoryData, refinedOcclusionMask, REGION_SIZE, REGION_SIZE, region, alpha);
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([0, 255, 0, 255]);
  });

  it("is red where hair overlaps real jewellery alpha", () => {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE).fill(255);
    const categoryData = uniformCategoryMask(HAIR, REGION_SIZE, REGION_SIZE);
    const refinedOcclusionMask = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE).fill(255); // occluded everywhere
    const rgba = buildJewelleryAlphaDebugRgba(categoryData, refinedOcclusionMask, REGION_SIZE, REGION_SIZE, region, alpha);
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([255, 0, 0, 255]);
  });

  it("is blue where clothing overlaps real jewellery alpha at/above the attachment point", () => {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE).fill(255);
    const categoryData = uniformCategoryMask(CLOTHES, REGION_SIZE, REGION_SIZE);
    // Mirrors the real attachment-line rule: rows <= attachmentYPx(2) occluded, rows below it visible.
    const refinedOcclusionMask = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    for (let y = 0; y <= region.attachmentYPx; y++) {
      for (let x = 0; x < REGION_SIZE; x++) refinedOcclusionMask[y * REGION_SIZE + x] = 255;
    }
    const rgba = buildJewelleryAlphaDebugRgba(categoryData, refinedOcclusionMask, REGION_SIZE, REGION_SIZE, region, alpha);
    // row 0 is <= attachmentYPx(2) -> blue.
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([0, 0, 255, 255]);
    // row 3 is > attachmentYPx(2) -> clothing doesn't occlude there -> reads as visible jewellery (green).
    const row3Offset = 3 * REGION_SIZE * 4;
    expect([rgba[row3Offset], rgba[row3Offset + 1], rgba[row3Offset + 2], rgba[row3Offset + 3]]).toEqual([0, 255, 0, 255]);
  });

  it("is always fully opaque and exactly maskWidthPx*maskHeightPx*4 bytes", () => {
    const alpha = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    const categoryData = uniformCategoryMask(BACKGROUND, REGION_SIZE, REGION_SIZE);
    const refinedOcclusionMask = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE);
    const rgba = buildJewelleryAlphaDebugRgba(categoryData, refinedOcclusionMask, REGION_SIZE, REGION_SIZE, region, alpha);
    expect(rgba.length).toBe(REGION_SIZE * REGION_SIZE * 4);
    for (let i = 0; i < REGION_SIZE * REGION_SIZE; i++) expect(rgba[i * 4 + 3]).toBe(255);
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
