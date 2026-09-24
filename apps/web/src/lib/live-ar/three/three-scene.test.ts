import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { addRestrainedLighting, createThreeScene, DEFAULT_LIGHTING_CONFIG } from "@/lib/live-ar/three/three-scene";

// applyEnvironmentLighting is NOT tested here -- it requires a real WebGLRenderer
// (PMREMGenerator performs an actual GPU render pass), which jsdom cannot provide.
// See that function's own doc comment.

describe("createThreeScene", () => {
  it("creates an empty Scene", () => {
    const scene = createThreeScene();
    expect(scene).toBeInstanceOf(THREE.Scene);
    expect(scene.children).toHaveLength(0);
  });
});

describe("addRestrainedLighting", () => {
  it("adds exactly one key (directional) and one fill (ambient) light to the scene", () => {
    const scene = createThreeScene();
    const { key, fill } = addRestrainedLighting(scene);
    expect(scene.children).toContain(key);
    expect(scene.children).toContain(fill);
    expect(key).toBeInstanceOf(THREE.DirectionalLight);
    expect(fill).toBeInstanceOf(THREE.AmbientLight);
    expect(scene.children).toHaveLength(2);
  });

  it("uses the default config's intensities when none is given", () => {
    const { key, fill } = addRestrainedLighting(createThreeScene());
    expect(key.intensity).toBe(DEFAULT_LIGHTING_CONFIG.keyIntensity);
    expect(fill.intensity).toBe(DEFAULT_LIGHTING_CONFIG.fillIntensity);
  });

  it("the fill light is dimmer than the key light -- 'restrained', never two equally strong lights", () => {
    const { key, fill } = addRestrainedLighting(createThreeScene());
    expect(fill.intensity).toBeLessThan(key.intensity);
  });

  it("respects an explicit config's intensities", () => {
    const { key, fill } = addRestrainedLighting(createThreeScene(), { keyIntensity: 5, fillIntensity: 1 });
    expect(key.intensity).toBe(5);
    expect(fill.intensity).toBe(1);
  });
});
