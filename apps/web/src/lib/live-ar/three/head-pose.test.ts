import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { decomposeFacialTransformMatrix } from "@/lib/live-ar/three/head-pose";

/**
 * These tests verify the DECOMPOSITION MATH is internally self-consistent, under
 * this module's own documented column-major-layout assumption -- see head-pose.ts's
 * file docstring. They cannot, and do not claim to, verify that MediaPipe's real
 * `Matrix.data` actually uses that layout; that requires a real device (see
 * docs/true-body-surface-jewellery-attachment.md §14).
 */
function matrixDataForEuler(yawRadians: number, pitchRadians: number, rollRadians: number): number[] {
  const euler = new THREE.Euler(pitchRadians, yawRadians, rollRadians, "YXZ");
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
  return matrix.toArray();
}

describe("decomposeFacialTransformMatrix", () => {
  it("returns null for null/missing input", () => {
    expect(decomposeFacialTransformMatrix(null)).toBeNull();
  });

  it("returns null for the wrong length", () => {
    expect(decomposeFacialTransformMatrix([1, 2, 3])).toBeNull();
  });

  it("returns null for non-finite values", () => {
    const bad = matrixDataForEuler(0, 0, 0);
    bad[0] = NaN;
    expect(decomposeFacialTransformMatrix(bad)).toBeNull();
  });

  it("recovers a pure yaw rotation", () => {
    const data = matrixDataForEuler(0.3, 0, 0);
    const pose = decomposeFacialTransformMatrix(data)!;
    expect(pose).not.toBeNull();
    expect(pose.yawRadians).toBeCloseTo(0.3, 5);
    expect(pose.pitchRadians).toBeCloseTo(0, 5);
    expect(pose.rollRadians).toBeCloseTo(0, 5);
  });

  it("recovers a pure pitch rotation", () => {
    const data = matrixDataForEuler(0, 0.2, 0);
    const pose = decomposeFacialTransformMatrix(data)!;
    expect(pose.pitchRadians).toBeCloseTo(0.2, 5);
    expect(pose.yawRadians).toBeCloseTo(0, 5);
  });

  it("recovers a pure roll rotation", () => {
    const data = matrixDataForEuler(0, 0, 0.15);
    const pose = decomposeFacialTransformMatrix(data)!;
    expect(pose.rollRadians).toBeCloseTo(0.15, 5);
  });

  it("recovers a combined yaw+pitch+roll rotation", () => {
    const data = matrixDataForEuler(0.4, -0.25, 0.1);
    const pose = decomposeFacialTransformMatrix(data)!;
    expect(pose.yawRadians).toBeCloseTo(0.4, 4);
    expect(pose.pitchRadians).toBeCloseTo(-0.25, 4);
    expect(pose.rollRadians).toBeCloseTo(0.1, 4);
  });

  it("returns a real, unit-length quaternion", () => {
    const data = matrixDataForEuler(0.4, 0.1, -0.2);
    const pose = decomposeFacialTransformMatrix(data)!;
    const [x, y, z, w] = pose.quaternion;
    expect(x * x + y * y + z * z + w * w).toBeCloseTo(1, 5);
  });

  it("a matrix embedding a translation still decomposes rotation correctly (translation is ignored, per this module's own documented scope)", () => {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3, 0, "YXZ"));
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(10, 20, 30), rotation, new THREE.Vector3(1, 1, 1));
    const pose = decomposeFacialTransformMatrix(Array.from(matrix.toArray()))!;
    expect(pose.yawRadians).toBeCloseTo(0.3, 5);
  });
});
