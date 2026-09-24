import { describe, expect, it, vi } from "vitest";

import {
  compositeOccluded3dOverlay,
  drawJewelleryOverlay,
  drawOccludedJewelleryOverlay,
  drawSegmentationDebugOverlay,
  ensureCanvasSize,
  renderLiveFrame,
} from "@/lib/live-ar/renderer";
import type { JewelleryStrip } from "@/lib/live-ar/jewellery-deformation";
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

  // M6.5 (jewellery-deformation.ts): strips is an OPTIONAL trailing parameter so every
  // test/call site above (written before M6.5) keeps passing unchanged -- these tests
  // cover the new opt-in path specifically.
  it("draws each strip as its own drawImage call, with the strip's own dropPx added to the local Y offset", () => {
    const { ctx, calls } = makeFakeCtx();
    const strips: JewelleryStrip[] = [
      { sourceX: 0, sourceWidth: 5, sourceHeight: 20, dropPx: 0 },
      { sourceX: 5, sourceWidth: 5, sourceHeight: 20, dropPx: 3 },
    ];
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1, strips);
    expect(calls).toEqual([
      "save",
      "translate(100,50)",
      `rotate(${(30 * Math.PI) / 180})`,
      "scale(2,2)",
      "drawImage",
      "drawImage",
      "restore",
    ]);
    // destX = strip.sourceX - sourceAnchorPx.x (10); destY = strip.dropPx - sourceAnchorPx.y (5).
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, expect.anything(), 0, 0, 5, 20, -10, -5, 5, 20);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, expect.anything(), 5, 0, 5, 20, -5, -2, 5, 20);
  });

  it("falls back to the single, whole-image drawImage call (byte-for-byte the pre-M6.5 behavior) when strips is null, undefined, or empty", () => {
    const cases: (JewelleryStrip[] | null | undefined)[] = [null, undefined, []];
    for (const strips of cases) {
      const { ctx, calls } = makeFakeCtx();
      drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1, strips);
      expect(calls).toEqual(["save", "translate(100,50)", `rotate(${(30 * Math.PI) / 180})`, "scale(2,2)", "drawImage", "restore"]);
      expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -10, -5);
    }
  });

  // M6.6 (neck-projection.ts): horizontalForeshorten is an OPTIONAL trailing
  // parameter, defaulting to 1 (a no-op) -- every M6.5 test above passes it implicitly.
  it("defaults horizontalForeshorten to 1 (no-op) when omitted", () => {
    const { ctx } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2); // unchanged from baseTransform's own scaleFactor
  });

  it("multiplies only the local X scale by horizontalForeshorten, leaving Y untouched", () => {
    const { ctx } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1, null, 0.7);
    expect(ctx.scale).toHaveBeenCalledWith(2 * 0.7, 2);
  });

  it("applies horizontalForeshorten AFTER the mirror flip (mirrored + foreshortened both negate/scale the same X axis)", () => {
    const { ctx } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, { ...baseTransform, mirrored: true }, 1, null, 0.7);
    expect(ctx.scale).toHaveBeenCalledWith(-2 * 0.7, 2);
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

  it("forwards jewellery.strips through to drawJewelleryOverlay", () => {
    const { ctx } = makeFakeCtx();
    const strips: JewelleryStrip[] = [{ sourceX: 0, sourceWidth: 10, sourceHeight: 10, dropPx: 1 }];
    renderLiveFrame(
      ctx,
      { video: {} as CanvasImageSource, videoWidthPx: 640, videoHeightPx: 480 },
      { image: {} as CanvasImageSource, transform: baseTransform, opacity: 1, strips }
    );
    // Call 1 is the video frame's own drawImage; call 2 is the (only) strip's.
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, expect.anything(), 0, 0, 10, 10, -10, -4, 10, 10);
  });

  it("forwards jewellery.horizontalForeshorten through to drawJewelleryOverlay", () => {
    const { ctx } = makeFakeCtx();
    renderLiveFrame(
      ctx,
      { video: {} as CanvasImageSource, videoWidthPx: 640, videoHeightPx: 480 },
      { image: {} as CanvasImageSource, transform: baseTransform, opacity: 1, horizontalForeshorten: 0.7 }
    );
    expect(ctx.scale).toHaveBeenCalledWith(2 * 0.7, 2);
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

  it("forwards strips through to its internal drawJewelleryOverlay call, so occlusion always composites against the SAME curved shape that's visible", () => {
    const { ctx, calls } = makeFakeCtx();
    const strips: JewelleryStrip[] = [{ sourceX: 0, sourceWidth: 20, sourceHeight: 20, dropPx: 2 }];
    drawOccludedJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1, {} as CanvasImageSource, 256, 256, 640, 480, strips);
    expect(calls).toEqual([
      "clearRect",
      "save",
      "translate(100,50)",
      `rotate(${(30 * Math.PI) / 180})`,
      "scale(2,2)",
      "drawImage", // the strip
      "restore",
      "save",
      "drawImage", // the erase
      "restore",
    ]);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, expect.anything(), 0, 0, 20, 20, -10, -3, 20, 20);
  });

  it("forwards horizontalForeshorten through to its internal drawJewelleryOverlay call", () => {
    const { ctx } = makeFakeCtx();
    drawOccludedJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1, {} as CanvasImageSource, 256, 256, 640, 480, null, 0.7);
    expect(ctx.scale).toHaveBeenCalledWith(2 * 0.7, 2);
  });
});

// M6.8 (spec Step 15): the 3D-rendering equivalent of drawOccludedJewelleryOverlay --
// no translate/rotate/scale (the Three.js camera already placed the mesh), only
// opacity + the SAME destination-out erase step.
describe("compositeOccluded3dOverlay", () => {
  it("draws the already-rendered 3D canvas directly (no transform calls at all), then erases with destination-out -- in that order", () => {
    const { ctx, calls, compositeOpAtDrawImage } = makeFakeCtx();
    const threeCanvas = {} as CanvasImageSource;
    const eraseMaskSource = {} as CanvasImageSource;
    compositeOccluded3dOverlay(ctx, threeCanvas, 1, eraseMaskSource, 256, 256, 640, 480);
    expect(calls).toEqual(["clearRect", "save", "drawImage", "restore", "save", "drawImage", "restore"]);
    expect(compositeOpAtDrawImage).toEqual(["source-over", "destination-out"]);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, threeCanvas, 0, 0, 640, 480);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(eraseMaskSource, 0, 0, 256, 256, 0, 0, 640, 480);
  });

  it("applies opacity via globalAlpha, clamped to [0, 1]", () => {
    const { ctx } = makeFakeCtx();
    compositeOccluded3dOverlay(ctx, {} as CanvasImageSource, 0.4, {} as CanvasImageSource, 256, 256, 640, 480);
    expect(ctx.globalAlpha).toBeCloseTo(0.4, 6);

    const { ctx: ctx2 } = makeFakeCtx();
    compositeOccluded3dOverlay(ctx2, {} as CanvasImageSource, 5, {} as CanvasImageSource, 256, 256, 640, 480);
    expect(ctx2.globalAlpha).toBe(1);
  });

  it("still clears and attempts the erase step even at zero opacity, skipping only the 3D canvas draw", () => {
    const { ctx, calls, compositeOpAtDrawImage } = makeFakeCtx();
    compositeOccluded3dOverlay(ctx, {} as CanvasImageSource, 0, {} as CanvasImageSource, 256, 256, 640, 480);
    expect(calls).toEqual(["clearRect", "save", "drawImage", "restore"]);
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
