import { describe, expect, it } from "vitest";

import { AngleEmaSmoother, ScalarEmaSmoother, TransformSmoother, emaAlphaForDt } from "@/lib/live-ar/smoothing";

describe("emaAlphaForDt", () => {
  it("is 0 for zero/negative dt (no update) and approaches 1 for very large dt", () => {
    expect(emaAlphaForDt(0, 120)).toBe(0);
    expect(emaAlphaForDt(-5, 120)).toBe(0);
    expect(emaAlphaForDt(100000, 120)).toBeCloseTo(1, 6);
  });

  it("is 1 (no smoothing) when the time constant is 0", () => {
    expect(emaAlphaForDt(16, 0)).toBe(1);
  });
});

describe("ScalarEmaSmoother", () => {
  it("takes the first sample as-is", () => {
    const s = new ScalarEmaSmoother(120);
    expect(s.update(100, 16)).toBe(100);
  });

  it("moves partway toward a step change, converging over repeated frames", () => {
    const s = new ScalarEmaSmoother(120);
    s.update(0, 16);
    const afterOneFrame = s.update(100, 16);
    expect(afterOneFrame).toBeGreaterThan(0);
    expect(afterOneFrame).toBeLessThan(100);

    let value = afterOneFrame;
    for (let i = 0; i < 50; i++) {
      value = s.update(100, 16);
    }
    expect(value).toBeCloseTo(100, 0);
  });

  it("does not introduce lag when fed the same constant value repeatedly", () => {
    const s = new ScalarEmaSmoother(120);
    s.update(42, 16);
    expect(s.update(42, 16)).toBeCloseTo(42, 9);
    expect(s.update(42, 16)).toBeCloseTo(42, 9);
  });

  it("reset() forgets prior state so the next sample is taken as-is", () => {
    const s = new ScalarEmaSmoother(120);
    s.update(0, 16);
    s.update(100, 16);
    s.reset();
    expect(s.current).toBeNull();
    expect(s.update(500, 16)).toBe(500);
  });
});

describe("AngleEmaSmoother", () => {
  it("smooths a small step normally", () => {
    const s = new AngleEmaSmoother(120);
    s.update(0, 16);
    const smoothed = s.update(10, 16);
    expect(smoothed).toBeGreaterThan(0);
    expect(smoothed).toBeLessThan(10);
  });

  it("treats a crossing of the +-180 boundary as a small step, not a 358deg swing", () => {
    const s = new AngleEmaSmoother(120);
    s.update(179, 16);
    const smoothed = s.update(-179, 16); // a real 2deg step across the wrap boundary
    // A correct unwrap keeps the result near +-180, not somewhere near 0.
    expect(Math.abs(smoothed)).toBeGreaterThan(170);
  });
});

describe("TransformSmoother", () => {
  it("smooths every component of a transform together", () => {
    const s = new TransformSmoother(120);
    const first = s.update({ anchorXPx: 100, anchorYPx: 200, scale: 1, rotationDegrees: 0 }, 16);
    expect(first).toEqual({ anchorXPx: 100, anchorYPx: 200, scale: 1, rotationDegrees: 0 });

    const second = s.update({ anchorXPx: 200, anchorYPx: 200, scale: 2, rotationDegrees: 10 }, 16);
    expect(second.anchorXPx).toBeGreaterThan(100);
    expect(second.anchorXPx).toBeLessThan(200);
    expect(second.scale).toBeGreaterThan(1);
    expect(second.scale).toBeLessThan(2);
  });

  it("reset() clears all component smoothers", () => {
    const s = new TransformSmoother(120);
    s.update({ anchorXPx: 100, anchorYPx: 200, scale: 1, rotationDegrees: 0 }, 16);
    s.reset();
    const afterReset = s.update({ anchorXPx: 999, anchorYPx: 999, scale: 5, rotationDegrees: 45 }, 16);
    expect(afterReset).toEqual({ anchorXPx: 999, anchorYPx: 999, scale: 5, rotationDegrees: 45 });
  });
});
