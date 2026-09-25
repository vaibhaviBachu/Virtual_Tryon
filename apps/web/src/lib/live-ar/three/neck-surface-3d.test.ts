import { describe, expect, it } from "vitest";

import { computeNeckSurfaceFrame, derivePxPerMm, neckSurfacePointAt, NECK_DEPTH_TO_WIDTH_RATIO_ESTIMATE } from "@/lib/live-ar/three/neck-surface-3d";
import type { SurfaceOrientation } from "@/lib/live-ar/three/body-attachment";

const NEUTRAL: SurfaceOrientation = { yawRadians: 0, pitchRadians: 0, rollRadians: 0, confidence: 1, method: "shoulder_roll_plus_real_facial_transform_matrix" };

describe("derivePxPerMm", () => {
  it("computes a real ratio from real inputs", () => {
    expect(derivePxPerMm(200, 190)).toBeCloseTo(200 / 190, 6);
  });

  it("returns null for missing/non-positive inputs, never divides by zero", () => {
    expect(derivePxPerMm(null, 190)).toBeNull();
    expect(derivePxPerMm(200, null)).toBeNull();
    expect(derivePxPerMm(0, 190)).toBeNull();
    expect(derivePxPerMm(200, 0)).toBeNull();
    expect(derivePxPerMm(-5, 190)).toBeNull();
  });
});

describe("computeNeckSurfaceFrame", () => {
  const front = { x: 0, y: 0, z: -500 };

  it("returns null when neck width or px-per-mm is unavailable -- never a fabricated radius", () => {
    expect(computeNeckSurfaceFrame(front, NEUTRAL, null, 5, 1)).toBeNull();
    expect(computeNeckSurfaceFrame(front, NEUTRAL, 100, null, 1)).toBeNull();
    expect(computeNeckSurfaceFrame(front, NEUTRAL, 0, 5, 1)).toBeNull();
  });

  it("radiusZ is derived from radiusX by the documented estimate ratio, never independently invented", () => {
    const frame = computeNeckSurfaceFrame(front, NEUTRAL, 300, 3, 1)!; // radiusX = 300/3/2 = 50mm
    expect(frame.radiusXMm).toBeCloseTo(50, 6);
    expect(frame.radiusZMm).toBeCloseTo(50 * NECK_DEPTH_TO_WIDTH_RATIO_ESTIMATE, 6);
  });

  it("at neutral orientation, the center is directly behind the tracked front point by radiusZ, along +Z", () => {
    const frame = computeNeckSurfaceFrame(front, NEUTRAL, 300, 3, 1)!;
    // axisForward at yaw=pitch=roll=0 is world +Z -- center = front - forward*radiusZ
    expect(frame.centerMm.x).toBeCloseTo(0, 5);
    expect(frame.centerMm.y).toBeCloseTo(0, 5);
    expect(frame.centerMm.z).toBeCloseTo(front.z - frame.radiusZMm, 5);
  });

  it("axes rotate with the real orientation -- a 90deg yaw swaps forward and right", () => {
    const yawed: SurfaceOrientation = { ...NEUTRAL, yawRadians: Math.PI / 2 };
    const frame = computeNeckSurfaceFrame(front, yawed, 300, 3, 1)!;
    // A +90deg yaw about Y rotates +Z toward +X (THREE's right-handed convention).
    expect(frame.axisForward.x).toBeCloseTo(1, 4);
    expect(frame.axisForward.z).toBeCloseTo(0, 4);
  });
});

describe("neckSurfacePointAt", () => {
  const front = { x: 10, y: 20, z: -500 };
  const frame = computeNeckSurfaceFrame(front, NEUTRAL, 300, 3, 1)!;

  it("angle=0 reconstructs exactly the original tracked front surface point (round-trip consistency)", () => {
    const point = neckSurfacePointAt(frame, 0);
    expect(point.position.x).toBeCloseTo(front.x, 5);
    expect(point.position.y).toBeCloseTo(front.y, 5);
    expect(point.position.z).toBeCloseTo(front.z, 5);
  });

  it("angle=0's normal points exactly along axisForward (the outward normal at the front IS the forward direction)", () => {
    const point = neckSurfacePointAt(frame, 0);
    expect(point.normal.x).toBeCloseTo(frame.axisForward.x, 5);
    expect(point.normal.y).toBeCloseTo(frame.axisForward.y, 5);
    expect(point.normal.z).toBeCloseTo(frame.axisForward.z, 5);
  });

  it("angle=+90deg lands on the +right side, with normal pointing along axisRight", () => {
    const point = neckSurfacePointAt(frame, Math.PI / 2);
    const expectedPos = {
      x: frame.centerMm.x + frame.axisRight.x * frame.radiusXMm,
      y: frame.centerMm.y + frame.axisRight.y * frame.radiusXMm,
      z: frame.centerMm.z + frame.axisRight.z * frame.radiusXMm,
    };
    expect(point.position.x).toBeCloseTo(expectedPos.x, 5);
    expect(point.normal.x).toBeCloseTo(frame.axisRight.x, 5);
  });

  it("every normal returned is a real unit vector", () => {
    for (const angle of [0, 0.3, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const { normal } = neckSurfacePointAt(frame, angle);
      const len = Math.hypot(normal.x, normal.y, normal.z);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it("tangent is perpendicular to normal at every angle (a real geometric consistency check)", () => {
    for (const angle of [0, 0.5, 1.2, Math.PI / 2]) {
      const { normal, tangent } = neckSurfacePointAt(frame, angle);
      const dot = normal.x * tangent.x + normal.y * tangent.y + normal.z * tangent.z;
      expect(dot).toBeCloseTo(0, 4);
    }
  });

  it("the surface outline is symmetric front-to-back for opposite angles offset by the same amount (a real ellipse property)", () => {
    const a = neckSurfacePointAt(frame, 0.4);
    const b = neckSurfacePointAt(frame, -0.4);
    // Both should be equidistant from the front point along the right axis (mirror symmetry).
    const rightOf = (p: { position: { x: number; y: number; z: number } }) =>
      (p.position.x - frame.centerMm.x) * frame.axisRight.x + (p.position.y - frame.centerMm.y) * frame.axisRight.y + (p.position.z - frame.centerMm.z) * frame.axisRight.z;
    expect(rightOf(a)).toBeCloseTo(-rightOf(b), 5);
  });
});
