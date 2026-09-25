import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildJewelleryCurve } from "@/lib/jewellery-3d-generator/curves";

describe("buildJewelleryCurve", () => {
  it("builds an OPEN curve from control points -- start/end match the authored endpoints exactly", () => {
    const curve = buildJewelleryCurve({
      kind: "open",
      shape: "control-points",
      controlPoints: [{ x: -10, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 0 }],
    });
    expect(curve.closed).toBe(false);
    const start = curve.getPointAt(0);
    const end = curve.getPointAt(1);
    expect(start.x).toBeCloseTo(-10, 1);
    expect(end.x).toBeCloseTo(10, 1);
  });

  it("builds a CLOSED curve for a circular shape -- every sampled point sits at the specified radius from the origin", () => {
    const curve = buildJewelleryCurve({ kind: "closed", shape: "circular", radiusMm: 8.8 });
    expect(curve.closed).toBe(true);
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
      const p = curve.getPointAt(t);
      const distanceFromOrigin = Math.sqrt(p.x * p.x + p.z * p.z);
      expect(distanceFromOrigin).toBeCloseTo(8.8, 0);
      expect(p.y).toBeCloseTo(0, 6);
    }
  });

  it("builds an elliptical curve with independent X/Z radii", () => {
    const curve = buildJewelleryCurve({ kind: "closed", shape: "elliptical", radiusXMm: 10, radiusYMm: 5 });
    const atZeroAngle = curve.getPoint(0); // shape's own parametrization starts at angle 0 -> (radiusX, 0, 0)
    expect(Math.abs(atZeroAngle.x)).toBeGreaterThan(Math.abs(atZeroAngle.z));
  });

  it("builds a straight line curve", () => {
    const curve = buildJewelleryCurve({ kind: "open", shape: "line", lineStart: { x: 0, y: 0, z: 0 }, lineEnd: { x: 0, y: 0, z: 20 } });
    const mid = curve.getPointAt(0.5);
    expect(mid.z).toBeCloseTo(10, 1);
  });

  it("throws a clear error for control-points with fewer than 2 points", () => {
    expect(() => buildJewelleryCurve({ kind: "open", shape: "control-points", controlPoints: [{ x: 0, y: 0, z: 0 }] })).toThrow(/at least 2/);
  });

  it("throws a clear error for circular with no radius", () => {
    expect(() => buildJewelleryCurve({ kind: "closed", shape: "circular" })).toThrow(/radiusMm/);
  });

  it("returns a real THREE.Curve usable for Frenet-style sampling (getTangentAt works)", () => {
    const curve = buildJewelleryCurve({ kind: "closed", shape: "circular", radiusMm: 5 });
    const tangent = curve.getTangentAt(0.25);
    expect(tangent).toBeInstanceOf(THREE.Vector3);
    expect(tangent.length()).toBeCloseTo(1, 3);
  });
});
