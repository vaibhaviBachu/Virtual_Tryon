import { describe, expect, it } from "vitest";

import { NECKLACE_MIN_HORIZONTAL_FORESHORTEN } from "@/lib/live-ar/constants";
import { computeContactDistanceFraction, computeContactPeakFraction, computeHorizontalForeshorten } from "@/lib/live-ar/neck-projection";

describe("computeContactPeakFraction", () => {
  it("is exactly 0.5 (M6.5's fixed center) when yaw asymmetry is 0", () => {
    expect(computeContactPeakFraction(0)).toBe(0.5);
  });

  it("shifts above 0.5 for positive yaw asymmetry", () => {
    expect(computeContactPeakFraction(0.5)).toBeGreaterThan(0.5);
  });

  it("shifts below 0.5 for negative yaw asymmetry, symmetric with the positive case", () => {
    const positive = computeContactPeakFraction(0.5);
    const negative = computeContactPeakFraction(-0.5);
    expect(negative).toBeLessThan(0.5);
    expect(0.5 - negative).toBeCloseTo(positive - 0.5, 10);
  });

  it("clamps input yaw beyond [-1, 1] the same as the boundary value (never extrapolates further)", () => {
    expect(computeContactPeakFraction(5)).toBe(computeContactPeakFraction(1));
    expect(computeContactPeakFraction(-5)).toBe(computeContactPeakFraction(-1));
  });

  it("never reaches the true edges (0 or 1), even at maximum yaw -- always a well-defined near/far side", () => {
    expect(computeContactPeakFraction(1)).toBeGreaterThanOrEqual(0.2);
    expect(computeContactPeakFraction(1)).toBeLessThanOrEqual(0.8);
    expect(computeContactPeakFraction(-1)).toBeGreaterThanOrEqual(0.2);
    expect(computeContactPeakFraction(-1)).toBeLessThanOrEqual(0.8);
  });
});

describe("computeContactDistanceFraction", () => {
  it("is 0 exactly at the peak, 1 at the nearer edge, for a centered peak (M6.5-equivalent, symmetric)", () => {
    expect(computeContactDistanceFraction(0.5, 0.5)).toBe(0);
    expect(computeContactDistanceFraction(0, 0.5)).toBeCloseTo(1, 10);
    expect(computeContactDistanceFraction(1, 0.5)).toBeCloseTo(1, 10);
  });

  it("is symmetric around a centered peak", () => {
    expect(computeContactDistanceFraction(0.3, 0.5)).toBeCloseTo(computeContactDistanceFraction(0.7, 0.5), 10);
  });

  it("reaches 1 at BOTH edges even for an off-center peak (near side is closer, far side is farther, both normalized to 1)", () => {
    const peak = 0.3;
    expect(computeContactDistanceFraction(0, peak)).toBeCloseTo(1, 10);
    expect(computeContactDistanceFraction(1, peak)).toBeCloseTo(1, 10);
    expect(computeContactDistanceFraction(peak, peak)).toBe(0);
  });

  it("increases monotonically moving away from the peak on either side", () => {
    const peak = 0.4;
    const leftSide = [0, 0.1, 0.2, 0.3, peak].map((t) => computeContactDistanceFraction(t, peak));
    for (let i = 1; i < leftSide.length; i++) expect(leftSide[i]).toBeLessThanOrEqual(leftSide[i - 1]);
    const rightSide = [peak, 0.6, 0.8, 1].map((t) => computeContactDistanceFraction(t, peak));
    for (let i = 1; i < rightSide.length; i++) expect(rightSide[i]).toBeGreaterThanOrEqual(rightSide[i - 1]);
  });

  it("clamps fraction01 outside [0, 1]", () => {
    expect(computeContactDistanceFraction(-0.5, 0.5)).toBe(computeContactDistanceFraction(0, 0.5));
    expect(computeContactDistanceFraction(1.5, 0.5)).toBe(computeContactDistanceFraction(1, 0.5));
  });
});

describe("computeHorizontalForeshorten", () => {
  const halfAngle = (60 * Math.PI) / 180;

  it("is exactly 1 (no foreshortening) at yaw=0 -- byte-for-byte M6.5's width", () => {
    expect(computeHorizontalForeshorten(0, halfAngle)).toBe(1);
  });

  it("decreases as |yaw asymmetry| increases", () => {
    const at0 = computeHorizontalForeshorten(0, halfAngle);
    const at0_3 = computeHorizontalForeshorten(0.3, halfAngle);
    const at0_8 = computeHorizontalForeshorten(0.8, halfAngle);
    expect(at0_3).toBeLessThan(at0);
    expect(at0_8).toBeLessThan(at0_3);
  });

  it("is symmetric in the sign of yaw asymmetry (foreshortening doesn't care about direction)", () => {
    expect(computeHorizontalForeshorten(0.4, halfAngle)).toBeCloseTo(computeHorizontalForeshorten(-0.4, halfAngle), 10);
  });

  it("never drops below the documented floor, even at maximum yaw and a wide curvature half-angle", () => {
    const wideAngle = (89 * Math.PI) / 180;
    expect(computeHorizontalForeshorten(1, wideAngle)).toBeGreaterThanOrEqual(NECKLACE_MIN_HORIZONTAL_FORESHORTEN);
    expect(computeHorizontalForeshorten(-1, wideAngle)).toBeGreaterThanOrEqual(NECKLACE_MIN_HORIZONTAL_FORESHORTEN);
  });

  it("a smaller curvature half-angle (e.g. haaram) foreshortens less than a wider one (e.g. choker) for the same yaw", () => {
    const chokerAngle = (70 * Math.PI) / 180;
    const haaramAngle = (40 * Math.PI) / 180;
    const chokerForeshorten = computeHorizontalForeshorten(0.7, chokerAngle);
    const haaramForeshorten = computeHorizontalForeshorten(0.7, haaramAngle);
    expect(haaramForeshorten).toBeGreaterThan(chokerForeshorten);
  });
});
