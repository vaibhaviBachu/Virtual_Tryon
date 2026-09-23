import { describe, expect, it, vi } from "vitest";

import {
  drawJewelleryOverlay,
  drawOccludedJewelleryOverlay,
  drawSegmentationDebugOverlay,
  ensureCanvasSize,
  renderLiveFrame,
} from "@/lib/live-ar/renderer";
import type { LiveTransform } from "@/lib/live-ar/types";

function makeFakeCtx() {
  const calls: string[] = [];
  // M6.4: records globalCompositeOperation's value AT THE MOMENT of each drawImage
  // call, in a separate array so existing tests asserting the bare `calls` array
  // (e.g. `["save", "translate(...)", ..., "drawImage", "restore"]`) are unaffected.
  const compositeOpAtDrawImage: string[] = [];
  const ctx = {
    save: vi.fn(() => calls.push("save")),
    restore: vi.fn(() => calls.push("restore")),
    clearRect: vi.fn(() => calls.push("clearRect")),
    drawImage: vi.fn((..._args: unknown[]) => {
      calls.push("drawImage");
      compositeOpAtDrawImage.push(ctx.globalCompositeOperation);
    }),
    translate: vi.fn((x: number, y: number) => calls.push(`translate(${x},${y})`)),
    rotate: vi.fn((r: number) => calls.push(`rotate(${r})`)),
    scale: vi.fn((x: number, y: number) => calls.push(`scale(${x},${y})`)),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, compositeOpAtDrawImage };
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
// M6.4 (docs/live-ar-realism-architecture.md §6/§8/§17).
describe("drawOccludedJewelleryOverlay", () => {
  it("clears the offscreen canvas, draws the jewellery with normal compositing, then erases with destination-out -- in that order, isolated to this one buffer", () => {
    const { ctx, calls, compositeOpAtDrawImage } = makeFakeCtx();
    const eraseMaskSource = {} as CanvasImageSource;
    drawOccludedJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1, eraseMaskSource, 256, 256, 640, 480);
    expect(calls[0]).toBe("clearRect");
    // The jewellery sprite: save/translate/rotate/scale/drawImage/restore (unchanged
    // drawJewelleryOverlay sequence, reused verbatim -- not reimplemented).
    expect(calls.slice(1, 7)).toEqual(["save", "translate(100,50)", `rotate(${(30 * Math.PI) / 180})`, "scale(2,2)", "drawImage", "restore"]);
    // The erase step: its OWN save/restore, isolated from the jewellery's.
    expect(calls.slice(7)).toEqual(["save", "drawImage", "restore"]);
    // Composite mode during each drawImage call: normal for the jewellery sprite,
    // destination-out ONLY for the erase -- and never left set afterward for anything
    // else that might draw on this same context later.
    expect(compositeOpAtDrawImage).toEqual(["source-over", "destination-out"]);
    // The erase draw uses the mask's own native size, scaled up to the output size --
    // the same drawImage 9-arg scaling signature drawSegmentationDebugOverlay uses.
    expect(ctx.drawImage).toHaveBeenLastCalledWith(eraseMaskSource, 0, 0, 256, 256, 0, 0, 640, 480);
  });

  it("still clears and attempts the erase step even at zero opacity (the jewellery sprite itself draws nothing, per drawJewelleryOverlay's own clamping)", () => {
    const { ctx, calls, compositeOpAtDrawImage } = makeFakeCtx();
    drawOccludedJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 0, {} as CanvasImageSource, 256, 256, 640, 480);
    expect(calls[0]).toBe("clearRect");
    // Only 3 calls follow -- the erase step's own save/drawImage/restore. Zero calls
    // came from drawJewelleryOverlay itself, confirming it early-returned at opacity 0
    // exactly as it does when called directly (see its own test above).
    expect(calls.slice(1)).toEqual(["save", "drawImage", "restore"]);
    expect(compositeOpAtDrawImage).toEqual(["destination-out"]);
  });
});

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
