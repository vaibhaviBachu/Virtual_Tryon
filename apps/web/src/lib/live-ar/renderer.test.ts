import { describe, expect, it, vi } from "vitest";

import { drawJewelleryOverlay, ensureCanvasSize, renderLiveFrame } from "@/lib/live-ar/renderer";
import type { LiveTransform } from "@/lib/live-ar/types";

/** A minimal but real save()/restore() STACK for the state properties these tests care
 * about -- a plain `{ globalAlpha: 1 }` object mock (this file's earlier version) does
 * not actually restore state on restore(), which would make an inner save/restore pair
 * (drawJewelleryOverlay's shadow pass) leak its dimmed globalAlpha into the real image
 * drawn after it, in the test double only -- a real browser's ctx.restore() does not
 * have that bug, so the mock needs to actually behave like one for these assertions to
 * mean anything. */
function makeFakeCtx() {
  const calls: string[] = [];
  const state = { globalAlpha: 1, fillStyle: "" as unknown };
  const stack: (typeof state)[] = [];
  const ctx: Record<string, unknown> = {
    save: vi.fn(() => {
      calls.push("save");
      stack.push({ ...state });
    }),
    restore: vi.fn(() => {
      calls.push("restore");
      const previous = stack.pop();
      if (previous) Object.assign(state, previous);
    }),
    clearRect: vi.fn(() => calls.push("clearRect")),
    // Records the alpha active AT THE MOMENT of this call, not whatever globalAlpha
    // reads after the function has fully returned (which, correctly, is back to
    // whatever it was before the outermost save() -- see this function's docstring).
    drawImage: vi.fn((..._args: unknown[]) => calls.push(`drawImage@${state.globalAlpha}`)),
    translate: vi.fn((x: number, y: number) => calls.push(`translate(${x},${y})`)),
    rotate: vi.fn((r: number) => calls.push(`rotate(${r})`)),
    scale: vi.fn((x: number, y: number) => calls.push(`scale(${x},${y})`)),
    createRadialGradient: vi.fn((x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => {
      calls.push(`createRadialGradient(${x0},${y0},${r0},${x1},${y1},${r1})`);
      return { addColorStop: vi.fn((offset: number, color: string) => calls.push(`addColorStop(${offset},${color})`)) };
    }),
    beginPath: vi.fn(() => calls.push("beginPath")),
    ellipse: vi.fn((x: number, y: number, rx: number, ry: number) => calls.push(`ellipse(${x},${y},${rx},${ry})`)),
    fill: vi.fn(() => calls.push(`fill@${state.globalAlpha}`)),
  };
  Object.defineProperty(ctx, "globalAlpha", {
    get: () => state.globalAlpha,
    set: (v: number) => {
      state.globalAlpha = v;
    },
  });
  Object.defineProperty(ctx, "fillStyle", {
    get: () => state.fillStyle,
    set: (v: unknown) => {
      state.fillStyle = v;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state };
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

  it("composes translate -> rotate -> scale -> drawImage in that order, anchoring on the source anchor (no shadow pass for an image with no readable natural size)", () => {
    const { ctx, calls } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 0.7);
    expect(calls).toEqual([
      "save",
      "translate(100,50)",
      `rotate(${(30 * Math.PI) / 180})`,
      "scale(2,2)",
      "drawImage@0.7",
      "restore",
    ]);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -10, -5);
    // After the matching restore(), alpha correctly reverts to whatever it was
    // before drawJewelleryOverlay's own save() -- 1, the mock's initial value --
    // not the 0.7 used during the draw itself (asserted via drawImage@0.7 above).
    expect(ctx.globalAlpha).toBeCloseTo(1, 6);
  });

  it("flips the scale's x component (not y) when mirrored", () => {
    const { ctx } = makeFakeCtx();
    drawJewelleryOverlay(ctx, {} as CanvasImageSource, { ...baseTransform, mirrored: true }, 1);
    expect(ctx.scale).toHaveBeenCalledWith(-2, 2);
  });

  it("draws a soft radial-gradient shadow blob before the real image, sized off the image's own natural width, when a readable natural size is available", () => {
    const { ctx, calls, state } = makeFakeCtx();
    const image = { naturalWidth: 1000, naturalHeight: 500 } as unknown as CanvasImageSource;
    drawJewelleryOverlay(ctx, image, baseTransform, 1);

    // Two full save/restore pairs: the shadow blob, then the real image.
    expect(calls.filter((c) => c === "save").length).toBe(2);
    expect(calls.filter((c) => c === "restore").length).toBe(2);

    // The shadow is a gradient-filled ellipse (never drawImage -- no compositing
    // mode involved at all, unlike the two prior, real, broken attempts this
    // replaced), centered at the local origin (which coincides with the asset's own
    // anchor point) and sized proportionally to the image's own 1000px natural
    // width, DIMMER than the real image (opacity * JEWELLERY_SHADOW_OPACITY = 0.4).
    expect(calls).toContain("createRadialGradient(0,80,0,0,80,400)");
    expect(calls).toContain("ellipse(0,80,400,160)");
    expect(calls).toContain("fill@0.4");

    // The real image is drawn once, at full opacity, after the shadow.
    expect(calls).toContain("drawImage@1");
    expect(calls.indexOf("fill@0.4")).toBeLessThan(calls.indexOf("drawImage@1"));

    // By the time drawJewelleryOverlay fully returns, alpha is back to whatever it
    // was before its outermost save() -- confirming restore() actually undid the
    // shadow's dimming rather than leaking it into anything drawn after.
    expect(state.globalAlpha).toBeCloseTo(1, 6);
  });

  it("skips the shadow pass (rather than throwing) for an image with no readable natural size", () => {
    const { ctx, calls } = makeFakeCtx();
    expect(() => drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1)).not.toThrow();
    expect(calls.filter((c) => c.startsWith("drawImage")).length).toBe(1);
    expect(calls.some((c) => c.startsWith("createRadialGradient") || c.startsWith("ellipse"))).toBe(false);
  });
});

describe("renderLiveFrame", () => {
  it("always clears and draws the video frame, and draws jewellery only when provided", () => {
    const { ctx, calls } = makeFakeCtx();
    renderLiveFrame(ctx, { video: {} as CanvasImageSource, videoWidthPx: 640, videoHeightPx: 480 }, null);
    expect(calls).toEqual(["clearRect", "drawImage@1"]);
  });

  it("draws the jewellery overlay after the video frame when provided", () => {
    const { ctx, calls } = makeFakeCtx();
    renderLiveFrame(
      ctx,
      { video: {} as CanvasImageSource, videoWidthPx: 640, videoHeightPx: 480 },
      { image: {} as CanvasImageSource, transform: baseTransform, opacity: 1 }
    );
    expect(calls[0]).toBe("clearRect");
    expect(calls[1]).toBe("drawImage@1"); // the video frame
    expect(calls).toContain("save"); // the overlay composition
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
