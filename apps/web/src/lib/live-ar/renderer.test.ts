import { describe, expect, it, vi } from "vitest";

import { drawJewelleryOverlay, drawSegmentationDebugOverlay, ensureCanvasSize, renderLiveFrame } from "@/lib/live-ar/renderer";
import type { LiveTransform } from "@/lib/live-ar/types";

function makeFakeCtx() {
  const calls: string[] = [];
  const ctx = {
    save: vi.fn(() => calls.push("save")),
    restore: vi.fn(() => calls.push("restore")),
    clearRect: vi.fn(() => calls.push("clearRect")),
    drawImage: vi.fn((..._args: unknown[]) => calls.push("drawImage")),
    translate: vi.fn((x: number, y: number) => calls.push(`translate(${x},${y})`)),
    rotate: vi.fn((r: number) => calls.push(`rotate(${r})`)),
    scale: vi.fn((x: number, y: number) => calls.push(`scale(${x},${y})`)),
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const baseTransform: LiveTransform = {
  anchorPx: { x: 100, y: 50 },
  scaleFactor: 2,
  rotationDegrees: 30,
  sourceAnchorPx: { x: 10, y: 5 },
  mirrored: false,
};

describe("drawJewelleryOverlay", () => {
  it("draws nothing at zero opacity", () => {
    const { ctx, calls } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 0);
    expect(calls).toEqual([]);
  });

  it("clamps opacity above 1 and below 0", () => {
    const { ctx } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 5);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("composes translate -> rotate -> scale -> drawImage in that order, anchoring on the source anchor", () => {
    const { ctx, calls } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 0.7);
    expect(calls).toEqual([
      "save",
      "translate(100,50)",
      `rotate(${(30 * Math.PI) / 180})`,
      "scale(2,2)",
      "drawImage",
      "restore",
    ]);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -10, -5);
    expect(ctx.globalAlpha).toBeCloseTo(0.7, 6);
  });

  it("flips the scale's x component (not y) when mirrored", () => {
    const { ctx } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, { ...baseTransform, mirrored: true }, 1);
    expect(ctx.scale).toHaveBeenCalledWith(-2, 2);
  });
});

describe("renderLiveFrame", () => {
  it("always clears and draws the video frame, and draws jewellery only when provided", () => {
    const { ctx, calls } = makeFakeCtx();
    renderLiveFrame(ctx, { video: {} as CanvasImageSource, videoWidthPx: 640, videoHeightPx: 480 }, null);
    expect(calls).toEqual(["clearRect", "drawImage"]);
  });

  it("draws the jewellery overlay after the video frame when provided", () => {
    const { ctx, calls } = makeFakeCtx();
    renderLiveFrame(
      ctx,
      { video: {} as CanvasImageSource, videoWidthPx: 640, videoHeightPx: 480 },
      { image: {} as CanvasImageSource, transform: baseTransform, opacity: 1 }
    );
    expect(calls[0]).toBe("clearRect");
    expect(calls[1]).toBe("drawImage"); // the video frame
    expect(calls).toContain("save"); // the overlay composition
  });
});

// M6.3 (docs/live-ar-realism-architecture.md §6/§8/§17): debug-only segmentation mask
// overlay. Only the call sequence/scaling arguments are tested -- this jsdom test
// environment has no real getContext("2d")/ImageData implementation (verified
// directly), so a fake mask "source" (mirroring makeFakeCtx's approach) is used
// instead of an actual canvas.
describe("drawSegmentationDebugOverlay", () => {
  it("draws the mask source scaled from its native size up to the video's actual size, in one drawImage call", () => {
    const { ctx, calls } = makeFakeCtx();
    const fakeMaskCanvas = {} as CanvasImageSource;
    drawSegmentationDebugOverlay(ctx, fakeMaskCanvas, 256, 256, 1280, 960);
    expect(calls).toEqual(["drawImage"]);
    expect(ctx.drawImage).toHaveBeenCalledWith(fakeMaskCanvas, 0, 0, 256, 256, 0, 0, 1280, 960);
  });

  it("never touches save/restore/transform state -- it's a plain scaled blit, not a transformed sprite", () => {
    const { ctx, calls } = makeFakeCtx();
    drawSegmentationDebugOverlay(ctx, {} as CanvasImageSource, 256, 256, 640, 480);
    expect(calls).toEqual(["drawImage"]);
  });
});

describe("ensureCanvasSize", () => {
  it("resizes and reports true when dimensions differ", () => {
    const canvas = { width: 100, height: 100 } as HTMLCanvasElement;
    expect(ensureCanvasSize(canvas, 640, 480)).toBe(true);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it("does nothing and reports false when dimensions already match", () => {
    const canvas = { width: 640, height: 480 } as HTMLCanvasElement;
    expect(ensureCanvasSize(canvas, 640, 480)).toBe(false);
  });
});
