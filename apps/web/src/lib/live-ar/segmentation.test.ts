import { describe, expect, it } from "vitest";

import {
  SEGMENTATION_CATEGORY_LABELS,
  SegmentationCadenceScheduler,
  buildSegmentationDebugRgba,
  toSegmentationResult,
  type SegmentationResult,
} from "@/lib/live-ar/segmentation";
import type { ImageSegmenterResult } from "@mediapipe/tasks-vision";

/**
 * Only the PURE result-shape conversion, cadence scheduling, and color-mapping logic
 * is tested here -- no real MediaPipe model/WASM load, matching tracking.test.ts's
 * established convention (see that file's own docstring for why fabricating a fake
 * model load would not be an honest test of anything).
 */

describe("SEGMENTATION_CATEGORY_LABELS", () => {
  it("has exactly the 6 verified categories in index order", () => {
    expect(SEGMENTATION_CATEGORY_LABELS).toEqual(["background", "hair", "body-skin", "face-skin", "clothes", "others"]);
  });
});

describe("toSegmentationResult", () => {
  it("returns null when there is no category mask", () => {
    const result = {} as ImageSegmenterResult;
    expect(toSegmentationResult(result)).toBeNull();
  });

  it("extracts category data and mask dimensions from a hand-built result (mirrors tracking.ts's toLiveFaceLandmarks convention)", () => {
    const categoryData = new Uint8Array([0, 1, 4, 2]);
    const result = {
      categoryMask: {
        getAsUint8Array: () => categoryData,
        width: 2,
        height: 2,
      },
    } as unknown as ImageSegmenterResult;
    const converted = toSegmentationResult(result);
    expect(converted).not.toBeNull();
    expect(converted!.categoryData).toBe(categoryData);
    expect(converted!.maskWidthPx).toBe(2);
    expect(converted!.maskHeightPx).toBe(2);
  });
});

function fakeResult(width: number, height: number): SegmentationResult {
  return { categoryData: new Uint8Array(width * height), maskWidthPx: width, maskHeightPx: height };
}

describe("SegmentationCadenceScheduler", () => {
  it("runs on the very first frame regardless of interval", () => {
    const scheduler = new SegmentationCadenceScheduler(500);
    expect(scheduler.shouldRun(0)).toBe(true);
  });

  it("does not run again before the interval has elapsed", () => {
    const scheduler = new SegmentationCadenceScheduler(500);
    scheduler.recordRun(1000, fakeResult(4, 4));
    expect(scheduler.shouldRun(1200)).toBe(false); // only 200ms elapsed
    expect(scheduler.shouldRun(1499)).toBe(false);
  });

  it("runs again once the interval has fully elapsed", () => {
    const scheduler = new SegmentationCadenceScheduler(500);
    scheduler.recordRun(1000, fakeResult(4, 4));
    expect(scheduler.shouldRun(1500)).toBe(true);
    expect(scheduler.shouldRun(2000)).toBe(true);
  });

  it("stale-mask reuse: getLatest() keeps returning the last successful result between runs", () => {
    const scheduler = new SegmentationCadenceScheduler(500);
    const first = fakeResult(4, 4);
    scheduler.recordRun(1000, first);
    expect(scheduler.getLatest()).toBe(first);
    // A later run that itself fails (null) must NOT erase the last good result.
    scheduler.recordRun(1500, null);
    expect(scheduler.getLatest()).toBe(first);
  });

  it("advances lastRunAtMs even on a failed run, so a repeatedly-failing segmenter is retried on cadence, not spammed every frame", () => {
    const scheduler = new SegmentationCadenceScheduler(500);
    scheduler.recordRun(1000, null);
    expect(scheduler.shouldRun(1200)).toBe(false);
    expect(scheduler.shouldRun(1500)).toBe(true);
  });

  it("getLatest() is null before any run has ever succeeded", () => {
    const scheduler = new SegmentationCadenceScheduler(500);
    expect(scheduler.getLatest()).toBeNull();
  });

  it("reset() clears both the timer and the last known result", () => {
    const scheduler = new SegmentationCadenceScheduler(500);
    scheduler.recordRun(1000, fakeResult(4, 4));
    scheduler.reset();
    expect(scheduler.getLatest()).toBeNull();
    expect(scheduler.shouldRun(1001)).toBe(true); // acts like the very first frame again
  });
});

describe("buildSegmentationDebugRgba", () => {
  it("makes background (category 0) fully transparent", () => {
    const rgba = buildSegmentationDebugRgba(new Uint8Array([0]), 1, 1);
    expect(rgba[3]).toBe(0); // alpha
  });

  it("gives every non-background category a distinct, semi-opaque color", () => {
    const rgba = buildSegmentationDebugRgba(new Uint8Array([1, 2, 3, 4, 5]), 5, 1);
    const pixels = [0, 1, 2, 3, 4].map((i) => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]]);
    // All 5 must be opaque (non-background alpha).
    for (const p of pixels) expect(p[3]).toBeGreaterThan(0);
    // All 5 colors must be pairwise distinct (a debug overlay where two categories look
    // identical would defeat the whole point of this visualization).
    const asStrings = pixels.map((p) => p.join(","));
    expect(new Set(asStrings).size).toBe(5);
  });

  it("produces exactly width*height*4 bytes", () => {
    const rgba = buildSegmentationDebugRgba(new Uint8Array(6), 3, 2);
    expect(rgba.length).toBe(3 * 2 * 4);
  });

  it("falls back to a defined color instead of throwing on an out-of-range category byte", () => {
    const rgba = buildSegmentationDebugRgba(new Uint8Array([99]), 1, 1);
    expect(rgba.length).toBe(4);
    expect(Number.isFinite(rgba[0])).toBe(true);
  });
});
