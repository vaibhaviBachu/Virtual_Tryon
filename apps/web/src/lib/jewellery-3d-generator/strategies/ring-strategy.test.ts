import { describe, expect, it } from "vitest";

import { ringStrategy } from "@/lib/jewellery-3d-generator/strategies/ring-strategy";
import type { Jewellery3DSpecification } from "@/lib/jewellery-3d-generator/types";

function minimalRingSpec(overrides: Partial<Jewellery3DSpecification> = {}): Jewellery3DSpecification {
  return {
    id: "test-ring",
    category: "ring",
    status: "synthetic_validation_fixture",
    provenanceNote: "unit test fixture",
    dimensions: { widthMm: 19, heightMm: 6, depthMm: 19 },
    attachment: { type: "finger", pointLocal: { x: 0, y: 0, z: 0 } },
    band: {
      curve: { kind: "closed", shape: "circular", radiusMm: 8.8 },
      crossSection: { widthMm: 2.2, depthMm: 1.6 },
      materialId: "gold",
    },
    materials: [{ id: "gold", preset: "gold" }],
    symmetry: { mirrored: false },
    ...overrides,
  };
}

describe("ringStrategy.buildComponentTree", () => {
  it("throws when there is no band", () => {
    expect(() => ringStrategy.buildComponentTree(minimalRingSpec({ band: null }))).toThrow(/requires a CLOSED "band"/);
  });

  it("throws when the band curve is OPEN -- a ring/bangle must be a closed loop", () => {
    const openBand = minimalRingSpec({
      band: { curve: { kind: "open", shape: "line", lineStart: { x: 0, y: 0, z: 0 }, lineEnd: { x: 10, y: 0, z: 0 } }, crossSection: { widthMm: 2, depthMm: 1 }, materialId: "gold" },
    });
    expect(() => ringStrategy.buildComponentTree(openBand)).toThrow(/CLOSED/);
  });

  it("always includes a band component", () => {
    const tree = ringStrategy.buildComponentTree(minimalRingSpec());
    expect(tree.children.some((c) => c.name === "band")).toBe(true);
  });

  it("a pendant field is realized as the ring's stone SETTING, with a nested gem", () => {
    const tree = ringStrategy.buildComponentTree(
      minimalRingSpec({
        pendant: {
          widthMm: 5,
          heightMm: 4,
          depthMm: 3,
          positionOnCurve: 0,
          forwardOffsetMm: 2.3,
          materialId: "gold",
          gem: { shape: "faceted", widthMm: 3, heightMm: 3, depthMm: 2, materialId: "gold", positionLocal: { x: 0, y: 0, z: 1.5 } },
        },
      })
    );
    const setting = tree.children.find((c) => c.name === "setting");
    expect(setting).toBeDefined();
    expect(setting!.children.some((c) => c.name === "setting-gem")).toBe(true);
  });

  it("radial repeating elements produce exactly the requested count, spread around the closed loop", () => {
    const tree = ringStrategy.buildComponentTree(
      minimalRingSpec({
        repeatingElements: [{ kind: "ornament", count: 6, placement: "radial", elementSizeMm: { widthMm: 1.5, heightMm: 1.5, depthMm: 1 }, materialId: "gold" }],
      })
    );
    const group = tree.children.find((c) => c.name === "repeating-elements-0");
    expect(group).toBeDefined();
    expect(group!.children).toHaveLength(6);
    // Every ornament should be roughly equidistant from the ring's own center
    // (radially placed, not clustered) -- a real check that "radial" placement
    // actually differs from "linear."
    const distances = group!.children.map((c) => Math.sqrt(c.position.x ** 2 + c.position.z ** 2));
    const [first, ...rest] = distances;
    for (const d of rest) expect(d).toBeCloseTo(first, 0);
  });

  it("a \"linear\"-placement repeating element is skipped entirely for a ring (ring/bangle ornaments are always radial)", () => {
    const tree = ringStrategy.buildComponentTree(
      minimalRingSpec({
        repeatingElements: [{ kind: "drop", count: 3, placement: "linear", elementSizeMm: { widthMm: 1, heightMm: 1, depthMm: 1 }, materialId: "gold" }],
      })
    );
    expect(tree.children.some((c) => c.name === "repeating-elements-0")).toBe(false);
  });
});
