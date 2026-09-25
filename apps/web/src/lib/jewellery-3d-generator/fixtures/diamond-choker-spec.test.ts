import { describe, expect, it } from "vitest";

import { buildDiamondChokerSpecification } from "@/lib/jewellery-3d-generator/fixtures/diamond-choker-spec";

describe("buildDiamondChokerSpecification", () => {
  it("adapts the real measurements JSON's own numbers, never inventing new physical dimensions", () => {
    const spec = buildDiamondChokerSpecification();
    expect(spec.category).toBe("necklace");
    expect(spec.status).toBe("prototype_estimated");
    expect(spec.dimensions.widthMm).toBe(190);
    expect(spec.dimensions.heightMm).toBe(106);
    expect(spec.dimensions.depthMm).toBe(12);
    expect(spec.provenanceNote).toMatch(/NOT physically measured/i);
  });

  it("the band's cross-section carries the measured band_thickness_mm/depth exactly", () => {
    const spec = buildDiamondChokerSpecification();
    expect(spec.band!.crossSection.widthMm).toBe(80);
    expect(spec.band!.crossSection.depthMm).toBe(12);
  });

  it("the curve's control points span exactly the measured width, symmetric about x=0", () => {
    const spec = buildDiamondChokerSpecification();
    const points = spec.band!.curve.controlPoints!;
    expect(points[0].x).toBe(-95);
    expect(points[2].x).toBe(95);
    expect(points[1].x).toBe(0);
  });

  it("the pendant and its gem are present and sized from the measured pendant dimensions", () => {
    const spec = buildDiamondChokerSpecification();
    expect(spec.pendant!.widthMm).toBe(34);
    expect(spec.pendant!.heightMm).toBe(38);
    expect(spec.pendant!.gem).not.toBeNull();
  });

  it("the drop fringe is graduated, longest matching the measured drop_length_mm exactly", () => {
    const spec = buildDiamondChokerSpecification();
    const drops = spec.repeatingElements![0];
    expect(drops.graduated!.longestMm).toBe(26);
  });

  it("declares two materials (gold, diamond), both referenced by id elsewhere in the spec", () => {
    const spec = buildDiamondChokerSpecification();
    const materialIds = new Set(spec.materials.map((m) => m.id));
    expect(materialIds.has("gold")).toBe(true);
    expect(materialIds.has("diamond")).toBe(true);
    expect(materialIds.has(spec.band!.materialId)).toBe(true);
  });
});
