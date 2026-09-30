import { describe, expect, it } from "vitest";

import { computeTopFadeAlphaMultiplier, NECKLACE_TOP_FADE_FRACTION_OF_BBOX_HEIGHT } from "@/lib/live-ar/jewellery-display-fade";

describe("computeTopFadeAlphaMultiplier", () => {
  it("is 0 at the very top of the visible bbox", () => {
    expect(computeTopFadeAlphaMultiplier(100, 100, 120)).toBe(0);
  });

  it("is 0 for any y above (less than) the bbox top -- never a negative or fabricated multiplier", () => {
    expect(computeTopFadeAlphaMultiplier(50, 100, 120)).toBe(0);
  });

  it("is 1 exactly at the fade-end point", () => {
    expect(computeTopFadeAlphaMultiplier(120, 100, 120)).toBe(1);
  });

  it("is 1 for any y below the fade-end point -- the rest of the jewellery is untouched", () => {
    expect(computeTopFadeAlphaMultiplier(500, 100, 120)).toBe(1);
    expect(computeTopFadeAlphaMultiplier(10000, 100, 120)).toBe(1);
  });

  it("ramps linearly in between", () => {
    expect(computeTopFadeAlphaMultiplier(110, 100, 120)).toBeCloseTo(0.5, 6);
    expect(computeTopFadeAlphaMultiplier(105, 100, 120)).toBeCloseTo(0.25, 6);
    expect(computeTopFadeAlphaMultiplier(115, 100, 120)).toBeCloseTo(0.75, 6);
  });

  it("never divides by zero for a degenerate (zero-height) fade band -- returns 1 (no fade) rather than NaN/Infinity", () => {
    expect(computeTopFadeAlphaMultiplier(100, 100, 100)).toBe(1);
    expect(computeTopFadeAlphaMultiplier(100, 100, 99)).toBe(1);
  });

  it("the shipped default fade fraction is small -- a soft blend at the very top tips, not a large fraction of the piece", () => {
    expect(NECKLACE_TOP_FADE_FRACTION_OF_BBOX_HEIGHT).toBeGreaterThan(0);
    expect(NECKLACE_TOP_FADE_FRACTION_OF_BBOX_HEIGHT).toBeLessThan(0.25);
  });
});
