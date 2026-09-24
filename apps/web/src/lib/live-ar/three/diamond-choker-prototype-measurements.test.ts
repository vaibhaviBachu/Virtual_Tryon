import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Validates docs/diamond-choker-prototype-measurements.json against itself -- a real
 * regression check (spec Step 7: "confirms height/width ≈ 0.558 and that the proposed
 * physical dimensions preserve approximately the same aspect ratio"), not a claim
 * about real jewellery. If someone edits that JSON later and breaks its own internal
 * consistency (e.g. changes physical_width_mm without updating physical_height_mm to
 * match), this test catches it. Reads the SAME file the geometry-generation step will
 * read -- no separate/duplicated copy of the numbers lives in this test.
 */
// vitest is always invoked with `apps/web` as the working directory in this project
// (its own package.json's "test" script, and every command in this repo's own
// verification docs) -- resolve relative to that rather than import.meta.url, which
// Vite's module transform doesn't guarantee is a real file:// URL.
const jsonPath = resolve(process.cwd(), "..", "..", "docs", "diamond-choker-prototype-measurements.json");
const spec = JSON.parse(readFileSync(jsonPath, "utf-8"));

describe("Diamond Choker prototype measurements (docs/diamond-choker-prototype-measurements.json)", () => {
  it("is explicitly labeled as a prototype estimate, never as verified/real physical data", () => {
    expect(spec.status).toBe("prototype_estimated");
    expect(spec.disclaimer).toMatch(/NOT physically measured/i);
    expect(spec.disclaimer).toMatch(/MUST NOT be written into/i);
  });

  it("the measured reference-image ratio matches the documented ~0.558", () => {
    expect(spec.measured_from_reference_image.height_to_width_ratio).toBeCloseTo(0.558, 3);
  });

  it("the proposed physical dimensions preserve approximately the same aspect ratio as the measured reference image", () => {
    const derivedRatio = spec.physical_height_mm / spec.physical_width_mm;
    expect(derivedRatio).toBeCloseTo(spec.measured_from_reference_image.height_to_width_ratio, 2);
  });

  it("band thickness + drop length reconstruct the overall height exactly (internal consistency)", () => {
    expect(spec.band_thickness_mm + spec.drop_length_mm).toBeCloseTo(spec.physical_height_mm, 6);
  });

  it("every physical dimension is a positive, finite number", () => {
    for (const key of [
      "physical_width_mm",
      "physical_height_mm",
      "physical_depth_mm",
      "band_thickness_mm",
      "central_pendant_width_mm",
      "central_pendant_height_mm",
      "drop_length_mm",
      "horizontal_wrap_sagitta_mm",
    ]) {
      expect(typeof spec[key]).toBe("number");
      expect(Number.isFinite(spec[key])).toBe(true);
      expect(spec[key]).toBeGreaterThan(0);
    }
  });

  it("the central pendant fits within the overall width/height (a real internal-consistency constraint, not just a positive number)", () => {
    expect(spec.central_pendant_width_mm).toBeLessThan(spec.physical_width_mm);
    expect(spec.central_pendant_height_mm).toBeLessThan(spec.physical_height_mm);
  });

  it("the band thickness alone does not exceed the overall height (drops must occupy some real portion of it)", () => {
    expect(spec.band_thickness_mm).toBeLessThan(spec.physical_height_mm);
  });

  it("declares a coordinate convention matching three-types.ts's own documented world-space axes", () => {
    expect(spec.coordinate_convention.up).toBe("+Y");
    expect(spec.coordinate_convention.handedness).toMatch(/right-handed/i);
  });
});
