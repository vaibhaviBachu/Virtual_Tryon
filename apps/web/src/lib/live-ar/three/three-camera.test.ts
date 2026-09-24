import { describe, expect, it } from "vitest";

import { buildCameraConfig, createThreeCamera, updateCameraForViewport } from "@/lib/live-ar/three/three-camera";
import { DEFAULT_FAR_MM, DEFAULT_NEAR_MM, DEFAULT_VERTICAL_FOV_DEGREES } from "@/lib/live-ar/three/three-types";

describe("buildCameraConfig", () => {
  it("derives aspect from the real viewport dimensions, using the documented default FOV/clip planes", () => {
    const config = buildCameraConfig(1280, 720);
    expect(config.aspect).toBeCloseTo(1280 / 720, 6);
    expect(config.verticalFovDegrees).toBe(DEFAULT_VERTICAL_FOV_DEGREES);
    expect(config.nearMm).toBe(DEFAULT_NEAR_MM);
    expect(config.farMm).toBe(DEFAULT_FAR_MM);
  });

  it("falls back to aspect 1 for a degenerate (zero-height) viewport rather than dividing by zero", () => {
    expect(buildCameraConfig(640, 0).aspect).toBe(1);
  });
});

describe("createThreeCamera", () => {
  it("creates a camera at the world origin, looking down -Z with an identity rotation", () => {
    const camera = createThreeCamera(buildCameraConfig(640, 480));
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
    expect(camera.position.z).toBe(0);
    expect(camera.quaternion.x).toBe(0);
    expect(camera.quaternion.y).toBe(0);
    expect(camera.quaternion.z).toBe(0);
    expect(camera.quaternion.w).toBe(1);
  });

  it("configures the camera's fov/aspect/near/far from the given config", () => {
    const config = buildCameraConfig(1280, 720);
    const camera = createThreeCamera(config);
    expect(camera.fov).toBe(config.verticalFovDegrees);
    expect(camera.aspect).toBeCloseTo(config.aspect, 6);
    expect(camera.near).toBe(config.nearMm);
    expect(camera.far).toBe(config.farMm);
  });
});

describe("updateCameraForViewport", () => {
  it("updates the camera's aspect and projection matrix when the viewport size changes", () => {
    const camera = createThreeCamera(buildCameraConfig(640, 480));
    const beforeMatrix = camera.projectionMatrix.clone();
    updateCameraForViewport(camera, 1920, 1080);
    expect(camera.aspect).toBeCloseTo(1920 / 1080, 6);
    expect(camera.projectionMatrix.equals(beforeMatrix)).toBe(false);
  });

  it("does nothing when the aspect ratio is unchanged (e.g. a proportional resize), avoiding an unnecessary matrix rebuild", () => {
    const camera = createThreeCamera(buildCameraConfig(640, 480));
    const beforeMatrix = camera.projectionMatrix.clone();
    updateCameraForViewport(camera, 1280, 960); // same 4:3 aspect, double resolution
    expect(camera.projectionMatrix.equals(beforeMatrix)).toBe(true);
  });
});
