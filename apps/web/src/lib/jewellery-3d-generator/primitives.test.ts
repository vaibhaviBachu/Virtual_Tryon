import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  computeGraduatedLengths,
  createBossGeometry,
  createDropGeometry,
  createFacetedGemGeometry,
  createRoundedGemGeometry,
  createSweptBandGeometry,
  evenlySpacedClosedCurveParams,
  evenlySpacedOpenCurveParams,
  mirrorPositionAcrossAxis,
} from "@/lib/jewellery-3d-generator/primitives";
import type { BandGeometrySpec } from "@/lib/jewellery-3d-generator/types";

function boundingSize(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getSize(new THREE.Vector3());
}

/** A real, non-mocked check that a geometry has genuine 3D volume, not a flat plane
 * (Phase D Step 14 / Step 16 item 10's explicit "no PNG billboard" requirement):
 * positive extent in all 3 axes, AND at least two meaningfully different vertex
 * normal directions (a flat plane's normals are all identical). */
function hasRealVolume(geometry: THREE.BufferGeometry): boolean {
  const size = boundingSize(geometry);
  if (!(size.x > 0.01 && size.y > 0.01 && size.z > 0.01)) return false;
  const normalAttr = geometry.getAttribute("normal");
  const first = new THREE.Vector3(normalAttr.getX(0), normalAttr.getY(0), normalAttr.getZ(0));
  for (let i = 1; i < normalAttr.count; i++) {
    const candidate = new THREE.Vector3(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
    if (first.angleTo(candidate) > 0.05) return true;
  }
  return false;
}

describe("createSweptBandGeometry", () => {
  const openBand: BandGeometrySpec = {
    curve: { kind: "open", shape: "line", lineStart: { x: -50, y: 0, z: 0 }, lineEnd: { x: 50, y: 0, z: 0 } },
    crossSection: { widthMm: 10, depthMm: 4 },
    materialId: "gold",
    segments: 8,
  };

  it("produces a real 3D solid, not a flat plane", () => {
    expect(hasRealVolume(createSweptBandGeometry(openBand))).toBe(true);
  });

  it("the cross-section's width/depth become real bounding-box extent", () => {
    const size = boundingSize(createSweptBandGeometry(openBand));
    expect(size.y).toBeCloseTo(10, 0); // crossSection.widthMm, measured along the fixed up axis
    expect(size.z).toBeCloseTo(4, 0); // crossSection.depthMm
    expect(size.x).toBeGreaterThan(99); // the full line length, plus a hair from end-cap geometry
  });

  it("a CLOSED curve (ring/bangle topology) produces a real annular solid with no gaps", () => {
    const closedBand: BandGeometrySpec = {
      curve: { kind: "closed", shape: "circular", radiusMm: 10 },
      crossSection: { widthMm: 2, depthMm: 1.5 },
      materialId: "gold",
      segments: 24,
    };
    const geometry = createSweptBandGeometry(closedBand);
    expect(hasRealVolume(geometry)).toBe(true);
    const size = boundingSize(geometry);
    // Outer diameter ~= 2*(radius + halfDepth) = 2*(10+0.75) = 21.5
    expect(size.x).toBeGreaterThan(20);
    expect(size.x).toBeLessThan(23);
    expect(size.z).toBeGreaterThan(20);
    expect(size.z).toBeLessThan(23);
  });

  it("an OPEN curve has end caps (a closed curve does not) -- open geometry is never watertight-without-caps by accident", () => {
    const openGeometry = createSweptBandGeometry(openBand);
    const closedGeometry = createSweptBandGeometry({
      curve: { kind: "closed", shape: "circular", radiusMm: 10 },
      crossSection: { widthMm: 2, depthMm: 1.5 },
      materialId: "gold",
      segments: 16,
    });
    // 4 side faces * segments * 2 tris, plus 2 end-cap faces (4 tris) for the open band.
    const openTriangleCount = openGeometry.getAttribute("position").count / 3;
    const closedTriangleCount = closedGeometry.getAttribute("position").count / 3;
    expect(openTriangleCount).toBe(8 * 4 * 2 + 4); // segments=8
    expect(closedTriangleCount).toBe(16 * 4 * 2); // segments=16, no caps
  });
});

describe("createBossGeometry / createDropGeometry / createFacetedGemGeometry / createRoundedGemGeometry", () => {
  it("boss (ellipsoid) has real volume matching its authored dimensions closely", () => {
    const geometry = createBossGeometry(30, 40, 12);
    expect(hasRealVolume(geometry)).toBe(true);
    const size = boundingSize(geometry);
    expect(size.x).toBeCloseTo(30, 0);
    expect(size.y).toBeCloseTo(40, 0);
    expect(size.z).toBeCloseTo(12, 0);
  });

  it("drop (cone) has real volume, apex at the top (attachment point), base hanging below", () => {
    const geometry = createDropGeometry(10, 26, 10);
    expect(hasRealVolume(geometry)).toBe(true);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.y).toBeCloseTo(13, 0); // height/2
    expect(box.min.y).toBeCloseTo(-13, 0);
  });

  it("faceted gem (octahedron) has real volume and genuinely distinct facet normals", () => {
    const geometry = createFacetedGemGeometry(6, 6, 4);
    expect(hasRealVolume(geometry)).toBe(true);
  });

  it("rounded gem (sphere) has real volume matching its authored dimensions closely", () => {
    const geometry = createRoundedGemGeometry(5, 5, 3);
    const size = boundingSize(geometry);
    expect(size.x).toBeCloseTo(5, 0);
    expect(size.z).toBeCloseTo(3, 0);
  });
});

describe("evenlySpacedOpenCurveParams / evenlySpacedClosedCurveParams", () => {
  it("open params stay strictly within (0, 1), excluding the very ends", () => {
    const params = evenlySpacedOpenCurveParams(5);
    expect(params).toHaveLength(5);
    for (const t of params) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
  });

  it("closed params start at 0 and are evenly spaced around the full loop", () => {
    const params = evenlySpacedClosedCurveParams(4);
    expect(params).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("count 0 returns an empty array for both", () => {
    expect(evenlySpacedOpenCurveParams(0)).toEqual([]);
    expect(evenlySpacedClosedCurveParams(0)).toEqual([]);
  });
});

describe("computeGraduatedLengths", () => {
  it("peaks at the true center for an odd count", () => {
    const lengths = computeGraduatedLengths(5, 10, 26);
    expect(lengths[2]).toBeCloseTo(26, 5); // center index
    expect(lengths[0]).toBeCloseTo(10, 5); // an end
    expect(lengths[4]).toBeCloseTo(10, 5); // the other end
    expect(lengths[0]).toBe(lengths[4]); // symmetric
  });

  it("a count of 1 returns the longest value alone (there is only a center)", () => {
    expect(computeGraduatedLengths(1, 10, 26)).toEqual([26]);
  });

  it("a count of 2 returns the SHORTEST value for both -- neither is a true center", () => {
    expect(computeGraduatedLengths(2, 10, 26)).toEqual([10, 10]);
  });
});

describe("mirrorPositionAcrossAxis", () => {
  it("mirrors across X, leaving Y/Z untouched", () => {
    expect(mirrorPositionAcrossAxis({ x: 5, y: 2, z: -3 }, "x")).toEqual({ x: -5, y: 2, z: -3 });
  });

  it("mirrors across Z, leaving X/Y untouched", () => {
    expect(mirrorPositionAcrossAxis({ x: 5, y: 2, z: -3 }, "z")).toEqual({ x: 5, y: 2, z: 3 });
  });
});
