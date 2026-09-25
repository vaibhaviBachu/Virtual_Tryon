import { describe, expect, it } from "vitest";

import { necklaceStrategy } from "@/lib/jewellery-3d-generator/strategies/necklace-strategy";
import type { Jewellery3DSpecification } from "@/lib/jewellery-3d-generator/types";

function minimalNecklaceSpec(overrides: Partial<Jewellery3DSpecification> = {}): Jewellery3DSpecification {
  return {
    id: "test-necklace",
    category: "necklace",
    status: "synthetic_validation_fixture",
    provenanceNote: "unit test fixture",
    dimensions: { widthMm: 100, heightMm: 60, depthMm: 10 },
    attachment: { type: "neck_choker", pointLocal: { x: 0, y: 0, z: 0 } },
    band: {
      curve: { kind: "open", shape: "line", lineStart: { x: -50, y: 0, z: 0 }, lineEnd: { x: 50, y: 0, z: 0 } },
      crossSection: { widthMm: 40, depthMm: 10 },
      materialId: "gold",
    },
    materials: [{ id: "gold", preset: "gold" }],
    symmetry: { mirrored: false },
    ...overrides,
  };
}

describe("necklaceStrategy.buildComponentTree", () => {
  it("throws when the specification has no band", () => {
    expect(() => necklaceStrategy.buildComponentTree(minimalNecklaceSpec({ band: null }))).toThrow(/requires a "band"/);
  });

  it("always includes a band component", () => {
    const tree = necklaceStrategy.buildComponentTree(minimalNecklaceSpec());
    expect(tree.children.some((c) => c.name === "band")).toBe(true);
  });

  it("includes a pendant with a nested gem when specified", () => {
    const tree = necklaceStrategy.buildComponentTree(
      minimalNecklaceSpec({
        pendant: {
          widthMm: 20,
          heightMm: 25,
          depthMm: 8,
          positionOnCurve: 0.5,
          forwardOffsetMm: 4,
          materialId: "gold",
          gem: { shape: "faceted", widthMm: 10, heightMm: 10, depthMm: 5, materialId: "gold", positionLocal: { x: 0, y: 0, z: 4 } },
        },
      })
    );
    const pendant = tree.children.find((c) => c.name === "pendant");
    expect(pendant).toBeDefined();
    expect(pendant!.children.some((c) => c.name === "pendant-gem")).toBe(true);
  });

  it("omits the pendant entirely when not specified", () => {
    const tree = necklaceStrategy.buildComponentTree(minimalNecklaceSpec());
    expect(tree.children.some((c) => c.name === "pendant")).toBe(false);
  });

  it("generates the exact requested count of graduated drops, longest at the true center", () => {
    const tree = necklaceStrategy.buildComponentTree(
      minimalNecklaceSpec({
        repeatingElements: [
          {
            kind: "drop",
            count: 5,
            placement: "linear",
            graduated: { shortestMm: 4, longestMm: 12 },
            elementSizeMm: { widthMm: 3, heightMm: 12, depthMm: 3 },
            materialId: "gold",
          },
        ],
      })
    );
    const dropsGroup = tree.children.find((c) => c.name === "repeating-elements-0");
    expect(dropsGroup).toBeDefined();
    expect(dropsGroup!.children).toHaveLength(5);
    // The center drop (index 2 of 5) hangs lower (further -Y) than an end drop, since
    // it's the longest -- proving the graduation actually reached the geometry, not
    // just the size parameter.
    const centerY = dropsGroup!.children[2].position.y;
    const endY = dropsGroup!.children[0].position.y;
    expect(centerY).toBeLessThan(endY);
  });

  it("standalone accent gems appear as top-level children", () => {
    const tree = necklaceStrategy.buildComponentTree(
      minimalNecklaceSpec({ gems: [{ shape: "faceted", widthMm: 4, heightMm: 4, depthMm: 3, materialId: "gold", positionLocal: { x: 10, y: 0, z: 5 } }] })
    );
    expect(tree.children.some((c) => c.name === "accent-gem-0")).toBe(true);
  });
});
