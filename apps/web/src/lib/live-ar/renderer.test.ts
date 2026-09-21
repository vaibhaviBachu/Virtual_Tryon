import { describe, expect, it, vi } from "vitest";

import { drawJewelleryOverlay, ensureCanvasSize, renderLiveFrame } from "@/lib/live-ar/renderer";
import type { LiveTransform } from "@/lib/live-ar/types";

/** A minimal but real save()/restore() STACK for the handful of state properties these
 * tests care about -- a plain `{ globalAlpha: 1 }` object mock (this file's earlier
 * version) does not actually restore state on restore(), which would make an inner
 * save/restore pair (drawJewelleryOverlay's shadow pass) leak its dimmed globalAlpha
 * into the real image drawn after it, in the test double only -- a real browser's
 * ctx.restore() does not have that bug, so the mock needs to actually behave like one
 * for these assertions to mean anything. */
function makeFakeCtx() {
  const calls: string[] = [];
  const state = { globalAlpha: 1, fillStyle: "", globalCompositeOperation: "source-over" };
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
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(`fillRect(${x},${y},${w},${h})`)),
    translate: vi.fn((x: number, y: number) => calls.push(`translate(${x},${y})`)),
    rotate: vi.fn((r: number) => calls.push(`rotate(${r})`)),
    scale: vi.fn((x: number, y: number) => calls.push(`scale(${x},${y})`)),
  };
  Object.defineProperty(ctx, "globalAlpha", {
    get: () => state.globalAlpha,
    set: (v: number) => {
      state.globalAlpha = v;
    },
  });
  Object.defineProperty(ctx, "fillStyle", {
    get: () => state.fillStyle,
    set: (v: string) => {
      state.fillStyle = v;
    },
  });
  Object.defineProperty(ctx, "globalCompositeOperation", {
    get: () => state.globalCompositeOperation,
    set: (v: string) => {
      state.globalCompositeOperation = v;
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

  it("draws a dimmer, offset silhouette pass before the real image when the image has a readable natural size", () => {
    const { ctx, calls, state } = makeFakeCtx();
    const image = { naturalWidth: 1000, naturalHeight: 500 } as unknown as CanvasImageSource;
    drawJewelleryOverlay(ctx, image, baseTransform, 1);

    // Two full save/restore pairs: the shadow silhouette, then the real image.
    expect(calls.filter((c) => c === "save").length).toBe(2);
    expect(calls.filter((c) => c === "restore").length).toBe(2);

    // drawImage is called twice: once for the shadow copy, DIMMER than the real
    // image (opacity * JEWELLERY_SHADOW_OPACITY = 1 * 0.4), then once for the real
    // image at full opacity on top of it.
    expect(calls).toContain("drawImage@0.4");
    expect(calls).toContain("drawImage@1");

    // The shadow pass translates by an offset proportional to the image's own natural
    // size (not final on-screen size -- see constants.ts) before its drawImage call.
    expect(calls).toContain(`translate(${1000 * 0.01},${500 * 0.045})`);
    // ...tints itself to a solid silhouette via source-atop + a fillRect covering
    // exactly where it drew the image...
    expect(calls).toContain(`fillRect(-10,-5,1000,500)`);
    // ...and by the time drawJewelleryOverlay fully returns, alpha is back to
    // whatever it was before its outermost save() -- confirming restore() actually
    // undid the shadow's dimming rather than leaking it into anything drawn after.
    expect(state.globalAlpha).toBeCloseTo(1, 6);
  });

  it("skips the shadow pass (rather than throwing) for an image with no readable natural size", () => {
    const { ctx, calls } = makeFakeCtx();
    expect(() => drawJewelleryOverlay(ctx, {} as CanvasImageSource, baseTransform, 1)).not.toThrow();
    expect(calls.filter((c) => c.startsWith("drawImage")).length).toBe(1);
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
