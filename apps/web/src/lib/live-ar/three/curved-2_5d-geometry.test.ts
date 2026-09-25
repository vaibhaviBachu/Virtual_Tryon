import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createCurvedRibbonGeometry, DEFAULT_RIBBON_SEGMENTS_U, DEFAULT_RIBBON_SEGMENTS_V } from "@/lib/live-ar/three/curved-2_5d-geometry";

const STRAIGHT_LINE = [
  { x: -95, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
  { x: 95, y: 0, z: 0 },
];

const CHOKER_CURVE = [
  { x: -95, y: 0, z: -18 },
  { x: 0, y: 0, z: 0 },
  { x: 95, y: 0, z: -18 },
];

function boundingSize(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getSize(new THREE.Vector3());
}

describe("createCurvedRibbonGeometry", () => {
  it("throws for fewer than 2 control points", () => {
    expect(() => createCurvedRibbonGeometry({ controlPointsMm: [{ x: 0, y: 0, z: 0 }], closed: false, heightMm: 100 })).toThrow(/at least 2/);
  });

  it("a straight-line curve produces a flat vertical ribbon of the correct height and width", () => {
    const geometry = createCurvedRibbonGeometry({ controlPointsMm: STRAIGHT_LINE, closed: false, heightMm: 106, segmentsU: 8, segmentsV: 4 });
    const size = boundingSize(geometry);
    expect(size.x).toBeCloseTo(190, 0);
    expect(size.y).toBeCloseTo(106, 0);
    expect(size.z).toBeCloseTo(0, 1); // dead flat -- no curvature at all
  });

  it("a curved (choker-shaped) control curve produces real depth (Z) extent -- proving the ribbon actually follows the curve, not just a flat plane", () => {
    const geometry = createCurvedRibbonGeometry({ controlPointsMm: CHOKER_CURVE, closed: false, heightMm: 106, segmentsU: 24, segmentsV: 8 });
    const size = boundingSize(geometry);
    expect(size.x).toBeCloseTo(190, 0);
    expect(size.z).toBeGreaterThan(10); // real, non-trivial depth from the sagitta
  });

  it("UVs span exactly [0,1] in both u and v, with v=0 at the top and v=1 at the bottom (Step 6's UV-preservation requirement -- pairing this with a texture requires texture.flipY = false, see curved-2_5d-bridge.ts's buildCurved25dAsset)", () => {
    const geometry = createCurvedRibbonGeometry({ controlPointsMm: STRAIGHT_LINE, closed: false, heightMm: 100, segmentsU: 8, segmentsV: 4 });
    const uv = geometry.getAttribute("uv");
    const position = geometry.getAttribute("position");
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    let topY = -Infinity, bottomY = Infinity, vAtTop = -1, vAtBottom = -1;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
      const y = position.getY(i);
      if (y > topY) { topY = y; vAtTop = v; }
      if (y < bottomY) { bottomY = y; vAtBottom = v; }
    }
    expect(minU).toBeCloseTo(0, 5);
    expect(maxU).toBeCloseTo(1, 5);
    expect(minV).toBeCloseTo(0, 5);
    expect(maxV).toBeCloseTo(1, 5);
    expect(vAtTop).toBeCloseTo(0, 5); // top of the mesh (max Y) is v=0
    expect(vAtBottom).toBeCloseTo(1, 5); // bottom of the mesh (min Y) is v=1
  });

  it("respects configurable segment counts (Step 5 -- not hardcoded)", () => {
    const coarse = createCurvedRibbonGeometry({ controlPointsMm: STRAIGHT_LINE, closed: false, heightMm: 100, segmentsU: 4, segmentsV: 2 });
    const fine = createCurvedRibbonGeometry({ controlPointsMm: STRAIGHT_LINE, closed: false, heightMm: 100, segmentsU: 40, segmentsV: 20 });
    expect(fine.getAttribute("position").count).toBeGreaterThan(coarse.getAttribute("position").count);
  });

  it("uses sensible, real defaults when segment counts are omitted", () => {
    const geometry = createCurvedRibbonGeometry({ controlPointsMm: STRAIGHT_LINE, closed: false, heightMm: 100 });
    const expectedTriangles = DEFAULT_RIBBON_SEGMENTS_U * DEFAULT_RIBBON_SEGMENTS_V * 2;
    expect(geometry.getAttribute("position").count / 3).toBe(expectedTriangles);
  });

  it("a closed curve (bangle/ring-family topology) produces a real, non-degenerate loop with no gap", () => {
    const closedLoop = [
      { x: 20, y: 0, z: 0 },
      { x: 0, y: 0, z: 20 },
      { x: -20, y: 0, z: 0 },
      { x: 0, y: 0, z: -20 },
    ];
    const geometry = createCurvedRibbonGeometry({ controlPointsMm: closedLoop, closed: true, heightMm: 10, segmentsU: 32, segmentsV: 4 });
    const size = boundingSize(geometry);
    expect(size.x).toBeGreaterThan(30);
    expect(size.z).toBeGreaterThan(30);
  });

  it("real vertex normals exist (never a degenerate/zero normal) -- required for the material to render at all", () => {
    const geometry = createCurvedRibbonGeometry({ controlPointsMm: CHOKER_CURVE, closed: false, heightMm: 106, segmentsU: 16, segmentsV: 4 });
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) {
      const len = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      expect(len).toBeGreaterThan(0.9);
    }
  });
});
