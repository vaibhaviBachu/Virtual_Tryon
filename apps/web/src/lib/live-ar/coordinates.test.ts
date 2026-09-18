import { describe, expect, it } from "vitest";

import {
  MIRROR_TRANSFORM_CSS,
  NO_MIRROR_TRANSFORM_CSS,
  containerMirrorTransform,
  denormalize,
  mirrorXInCanvasSpace,
} from "@/lib/live-ar/coordinates";

describe("denormalize", () => {
  it("converts a normalized top-left-origin point into pixel space", () => {
    const px = denormalize({ x: 0.5, y: 0.25 }, 640, 480);
    expect(px).toEqual({ x: 320, y: 120 });
  });

  it("is the identity at the origin and at (1,1)", () => {
    expect(denormalize({ x: 0, y: 0 }, 1000, 500)).toEqual({ x: 0, y: 0 });
    expect(denormalize({ x: 1, y: 1 }, 1000, 500)).toEqual({ x: 1000, y: 500 });
  });
});

describe("containerMirrorTransform", () => {
  it("returns the shared mirror transform when mirrored is true", () => {
    expect(containerMirrorTransform(true)).toBe(MIRROR_TRANSFORM_CSS);
    expect(containerMirrorTransform(true)).toBe("scaleX(-1)");
  });

  it("returns no transform when mirrored is false", () => {
    expect(containerMirrorTransform(false)).toBe(NO_MIRROR_TRANSFORM_CSS);
    expect(containerMirrorTransform(false)).toBe("none");
  });
});

describe("mirroring does not require per-point coordinate math for jewellery placement", () => {
  /**
   * Regression test for the exact bug class spec §7 warns about: an anchor computed in
   * unmirrored tracking space must land at the SAME unmirrored pixel position
   * regardless of whether the preview happens to be shown mirrored — because mirroring
   * is applied once to the whole video+canvas wrapper, never to the anchor itself. If a
   * future change accidentally started mirroring individual anchor points (which would
   * double-mirror left/right earrings relative to the wrapper transform), this test
   * would need denormalize() to behave differently depending on a "mirrored" flag it
   * deliberately does not accept.
   */
  it("denormalize has no mirrored parameter — a left-ear landmark stays on the left in tracking space either way", () => {
    const leftEarLandmark = { x: 0.2, y: 0.5 }; // smaller x = image-left, per ai/landmarks/face.py convention
    const rightEarLandmark = { x: 0.8, y: 0.5 };

    const leftPx = denormalize(leftEarLandmark, 640, 480);
    const rightPx = denormalize(rightEarLandmark, 640, 480);

    expect(leftPx.x).toBeLessThan(rightPx.x);
    // denormalize.length === 3 (point, width, height) confirms no hidden mirror flag exists.
    expect(denormalize.length).toBe(3);
  });
});

describe("mirrorXInCanvasSpace", () => {
  it("reflects a pixel x-coordinate across the canvas width", () => {
    expect(mirrorXInCanvasSpace(0, 640)).toBe(640);
    expect(mirrorXInCanvasSpace(640, 640)).toBe(0);
    expect(mirrorXInCanvasSpace(320, 640)).toBe(320);
  });

  it("is its own inverse", () => {
    const x = 123.4;
    const width = 800;
    expect(mirrorXInCanvasSpace(mirrorXInCanvasSpace(x, width), width)).toBeCloseTo(x, 10);
  });
});
