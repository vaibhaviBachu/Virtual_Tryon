import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  composeJewelleryQuaternion,
  computeMeshScaleFactor,
  computeThreeJewelleryTransform,
  computeVirtualDepthMm,
  projectWorldBoundingBoxToScreen,
  unprojectScreenPointAtDepth,
  yawAsymmetryToRadians,
} from "@/lib/live-ar/three/three-transform";
import type { ThreeCameraConfig } from "@/lib/live-ar/three/three-types";
import type { RotationResult, ScaleResult } from "@/lib/live-ar/types";

const CONFIG: ThreeCameraConfig = { verticalFovDegrees: 50, aspect: 640 / 480, nearMm: 1, farMm: 10000 };

describe("computeVirtualDepthMm", () => {
  it("projects a physicalWidthMm-wide object to exactly targetWidthPx at the returned depth (round-trip check)", () => {
    const physicalWidthMm = 300;
    const targetWidthPx = 200;
    const viewportHeightPx = 480;
    const depthMm = computeVirtualDepthMm(physicalWidthMm, targetWidthPx, viewportHeightPx, 50);
    const halfFov = (50 * Math.PI) / 360;
    const pxPerMm = viewportHeightPx / (2 * depthMm * Math.tan(halfFov));
    expect(physicalWidthMm * pxPerMm).toBeCloseTo(targetWidthPx, 6);
  });

  it("is independent of the assumed FOV in what it guarantees: the round-trip always reproduces targetWidthPx regardless of FOV", () => {
    for (const fov of [30, 50, 70, 100]) {
      const depthMm = computeVirtualDepthMm(300, 200, 480, fov);
      const halfFov = (fov * Math.PI) / 360;
      const pxPerMm = 480 / (2 * depthMm * Math.tan(halfFov));
      expect(300 * pxPerMm).toBeCloseTo(200, 6);
    }
  });

  it("returns the safe fallback depth for degenerate inputs (zero/negative targetWidthPx, non-finite physical width, >=180deg FOV)", () => {
    expect(computeVirtualDepthMm(300, 0, 480, 50)).toBe(500);
    expect(computeVirtualDepthMm(300, -10, 480, 50)).toBe(500);
    expect(computeVirtualDepthMm(NaN, 200, 480, 50)).toBe(500);
    expect(computeVirtualDepthMm(300, 200, 480, 180)).toBe(500);
    expect(computeVirtualDepthMm(0, 200, 480, 50)).toBe(500);
  });

  it("larger targetWidthPx (item appears bigger on screen) means a SMALLER virtual depth (closer to camera)", () => {
    const far = computeVirtualDepthMm(300, 100, 480, 50);
    const near = computeVirtualDepthMm(300, 300, 480, 50);
    expect(near).toBeLessThan(far);
  });
});

describe("unprojectScreenPointAtDepth", () => {
  it("maps the exact viewport center to world (0, 0, -depth)", () => {
    const result = unprojectScreenPointAtDepth({ x: 320, y: 240 }, 640, 480, 500, CONFIG);
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(0, 6);
    expect(result.z).toBe(-500);
  });

  it("maps a point above screen-center (smaller y) to a positive world Y (Y-up flip)", () => {
    const result = unprojectScreenPointAtDepth({ x: 320, y: 100 }, 640, 480, 500, CONFIG);
    expect(result.y).toBeGreaterThan(0);
  });

  it("maps a point right of screen-center to a positive world X", () => {
    const result = unprojectScreenPointAtDepth({ x: 500, y: 240 }, 640, 480, 500, CONFIG);
    expect(result.x).toBeGreaterThan(0);
  });

  it("always returns z = -depthMm exactly, regardless of screen position", () => {
    expect(unprojectScreenPointAtDepth({ x: 0, y: 0 }, 640, 480, 750, CONFIG).z).toBe(-750);
    expect(unprojectScreenPointAtDepth({ x: 640, y: 480 }, 640, 480, 750, CONFIG).z).toBe(-750);
  });

  it("a point twice as far from center is twice as far in world space (linear at a fixed depth)", () => {
    const centerOffset = unprojectScreenPointAtDepth({ x: 420, y: 240 }, 640, 480, 500, CONFIG); // +100px from center(320)
    const doubleOffset = unprojectScreenPointAtDepth({ x: 520, y: 240 }, 640, 480, 500, CONFIG); // +200px from center
    expect(doubleOffset.x).toBeCloseTo(centerOffset.x * 2, 6);
  });
});

describe("composeJewelleryQuaternion", () => {
  it("is the identity quaternion at yaw=0, roll=0", () => {
    const [x, y, z, w] = composeJewelleryQuaternion(0, 0);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(0, 10);
    expect(w).toBeCloseTo(1, 10);
  });

  it("a pure roll produces a unit quaternion rotating only around the local Z axis", () => {
    const [x, y, z, w] = composeJewelleryQuaternion(0, Math.PI / 4);
    const q = new THREE.Quaternion(x, y, z, w);
    expect(q.length()).toBeCloseTo(1, 10);
    // Rotating +Y by this quaternion should stay in the XY plane (no Z component) for
    // a pure roll (Z-axis rotation).
    const rotated = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(rotated.z).toBeCloseTo(0, 6);
  });

  it("a pure yaw rotates the +X axis toward -Z (Three.js's own right-handed Y-axis convention)", () => {
    const [x, y, z, w] = composeJewelleryQuaternion(Math.PI / 2, 0);
    const q = new THREE.Quaternion(x, y, z, w);
    const rotated = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(rotated.x).toBeCloseTo(0, 6);
    expect(rotated.z).toBeCloseTo(-1, 6);
  });

  it("always produces a normalized (unit-length) quaternion", () => {
    const [x, y, z, w] = composeJewelleryQuaternion(0.7, -1.2);
    const length = Math.sqrt(x * x + y * y + z * z + w * w);
    expect(length).toBeCloseTo(1, 10);
  });
});

describe("yawAsymmetryToRadians", () => {
  it("maps null (no face tracked) to exactly 0 -- never a fabricated angle", () => {
    expect(yawAsymmetryToRadians(null)).toBe(0);
  });

  it("maps 0 asymmetry to 0 radians", () => {
    expect(yawAsymmetryToRadians(0)).toBe(0);
  });

  it("scales linearly with the asymmetry proxy within [-1, 1]", () => {
    const atHalf = yawAsymmetryToRadians(0.5);
    const atFull = yawAsymmetryToRadians(1);
    expect(atFull).toBeCloseTo(atHalf * 2, 10);
  });

  it("clamps asymmetry beyond [-1, 1] to the boundary value", () => {
    expect(yawAsymmetryToRadians(5)).toBe(yawAsymmetryToRadians(1));
    expect(yawAsymmetryToRadians(-5)).toBe(yawAsymmetryToRadians(-1));
  });
});

describe("computeMeshScaleFactor", () => {
  it("scales the mesh so its authored width matches the real physical width", () => {
    expect(computeMeshScaleFactor(150, 100)).toBeCloseTo(1.5, 6);
  });

  it("falls back to 1 (use the mesh exactly as authored) when physicalWidthMm is null or non-positive", () => {
    expect(computeMeshScaleFactor(null, 100)).toBe(1);
    expect(computeMeshScaleFactor(0, 100)).toBe(1);
    expect(computeMeshScaleFactor(-5, 100)).toBe(1);
  });

  it("falls back to 1 when the mesh's own bounding-box width is non-positive (degenerate/empty mesh)", () => {
    expect(computeMeshScaleFactor(150, 0)).toBe(1);
    expect(computeMeshScaleFactor(150, -10)).toBe(1);
  });
});

describe("computeThreeJewelleryTransform", () => {
  const goodScale: ScaleResult = { success: true, scaleFactor: 2, targetWidthPx: 200, usedPhysicalDimensions: true, method: "physical_mm_via_shoulder_width_calibration" };
  const goodRotation: RotationResult = { success: true, rotationDegrees: 10, rawDegrees: 10, clamped: false, method: "shoulder_landmark_tilt" };

  it("returns null when the 2D scale computation failed -- never fabricates a transform from partial data", () => {
    const failedScale: ScaleResult = { success: false, scaleFactor: 0, targetWidthPx: null, usedPhysicalDimensions: false, method: "no_reference_measurement" };
    expect(computeThreeJewelleryTransform({ x: 320, y: 240 }, failedScale, goodRotation, 0, 300, 100, 640, 480, CONFIG)).toBeNull();
  });

  it("returns null when the 2D rotation computation failed", () => {
    const failedRotation: RotationResult = { success: false, rotationDegrees: 0, rawDegrees: null, clamped: false, method: "neutral_fallback_no_landmarks" };
    expect(computeThreeJewelleryTransform({ x: 320, y: 240 }, goodScale, failedRotation, 0, 300, 100, 640, 480, CONFIG)).toBeNull();
  });

  it("returns a real transform whose position projects back to the requested 2D anchor and whose scale/quaternion match the sub-functions", () => {
    const result = computeThreeJewelleryTransform({ x: 400, y: 200 }, goodScale, goodRotation, 0.3, 300, 100, 640, 480, CONFIG)!;
    expect(result).not.toBeNull();
    expect(result.scale).toBeCloseTo(3, 6); // 300 / 100
    expect(result.quaternion).toEqual(composeJewelleryQuaternion(yawAsymmetryToRadians(0.3), (10 * Math.PI) / 180));

    // Re-project the returned position through the SAME camera config to confirm it
    // lands back on the original 2D screen anchor (400, 200).
    const camera = new THREE.PerspectiveCamera(CONFIG.verticalFovDegrees, CONFIG.aspect, CONFIG.nearMm, CONFIG.farMm);
    camera.updateProjectionMatrix();
    const worldPoint = new THREE.Vector3(result.positionMm.x, result.positionMm.y, result.positionMm.z);
    const ndc = worldPoint.clone().project(camera);
    const screenX = ((ndc.x + 1) / 2) * 640;
    const screenY = ((1 - ndc.y) / 2) * 480;
    expect(screenX).toBeCloseTo(400, 3);
    expect(screenY).toBeCloseTo(200, 3);
  });
});

describe("projectWorldBoundingBoxToScreen", () => {
  it("projects a box centered on the camera's forward axis to a screen-centered rectangle", () => {
    const camera = new THREE.PerspectiveCamera(50, 640 / 480, 1, 10000);
    camera.updateProjectionMatrix();
    const box = new THREE.Box3(new THREE.Vector3(-10, -10, -510), new THREE.Vector3(10, 10, -490));
    const [left, top, right, bottom] = projectWorldBoundingBoxToScreen(box, camera, 640, 480);
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    expect(centerX).toBeCloseTo(320, 1);
    expect(centerY).toBeCloseTo(240, 1);
    expect(right).toBeGreaterThan(left);
    expect(bottom).toBeGreaterThan(top);
  });

  it("a wider box (larger X extent) projects to a wider screen rectangle", () => {
    const camera = new THREE.PerspectiveCamera(50, 640 / 480, 1, 10000);
    camera.updateProjectionMatrix();
    const narrow = new THREE.Box3(new THREE.Vector3(-10, -10, -510), new THREE.Vector3(10, 10, -490));
    const wide = new THREE.Box3(new THREE.Vector3(-50, -10, -510), new THREE.Vector3(50, 10, -490));
    const narrowScreen = projectWorldBoundingBoxToScreen(narrow, camera, 640, 480);
    const wideScreen = projectWorldBoundingBoxToScreen(wide, camera, 640, 480);
    expect(wideScreen[2] - wideScreen[0]).toBeGreaterThan(narrowScreen[2] - narrowScreen[0]);
  });
});
