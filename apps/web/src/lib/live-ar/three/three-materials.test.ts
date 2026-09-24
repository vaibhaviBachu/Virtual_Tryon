import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { applyFallbackMaterialWhereMissing, createFallbackGoldMaterial, isEveryMeshPbr } from "@/lib/live-ar/three/three-materials";

function meshWithoutMaterial(): THREE.Mesh {
  // A real Mesh always needs SOME material passed to its constructor for Three.js's
  // own types; simulate "no material" the way a bare/placeholder mesh actually would
  // arrive at runtime -- by clearing it after construction.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  // @ts-expect-error -- deliberately simulating an absent material for this test.
  mesh.material = undefined;
  return mesh;
}

describe("createFallbackGoldMaterial", () => {
  it("is metallic ≈ 1 with non-zero roughness (never a flat colour tint, never a mirror-smooth fake)", () => {
    const material = createFallbackGoldMaterial();
    expect(material.metalness).toBe(1);
    expect(material.roughness).toBeGreaterThan(0);
    expect(material.roughness).toBeLessThan(1);
  });

  it("is a real PBR material class (MeshStandardMaterial), not a plain colour-only material", () => {
    expect(createFallbackGoldMaterial()).toBeInstanceOf(THREE.MeshStandardMaterial);
  });
});

describe("applyFallbackMaterialWhereMissing", () => {
  it("assigns the fallback material to a mesh with no material at all", () => {
    const group = new THREE.Group();
    const bareMesh = meshWithoutMaterial();
    group.add(bareMesh);
    const count = applyFallbackMaterialWhereMissing(group);
    expect(count).toBe(1);
    expect(bareMesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it("leaves a mesh's own real, authored material completely untouched", () => {
    const group = new THREE.Group();
    const realMaterial = new THREE.MeshPhysicalMaterial({ color: "#ffffff", metalness: 0.8, roughness: 0.2 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), realMaterial);
    group.add(mesh);
    const count = applyFallbackMaterialWhereMissing(group);
    expect(count).toBe(0);
    expect(mesh.material).toBe(realMaterial);
  });

  it("handles a scene graph with a mix of meshes needing and not needing the fallback", () => {
    const group = new THREE.Group();
    const realMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff" });
    const withMaterial = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), realMaterial);
    const withoutMaterial = meshWithoutMaterial();
    const nested = new THREE.Group();
    nested.add(withoutMaterial);
    group.add(withMaterial, nested);
    const count = applyFallbackMaterialWhereMissing(group);
    expect(count).toBe(1);
    expect(withMaterial.material).toBe(realMaterial);
    expect(withoutMaterial.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it("returns 0 for a scene graph with no meshes at all", () => {
    expect(applyFallbackMaterialWhereMissing(new THREE.Group())).toBe(0);
  });
});

describe("isEveryMeshPbr", () => {
  it("is true when every mesh has a MeshStandardMaterial or MeshPhysicalMaterial", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhysicalMaterial()));
    expect(isEveryMeshPbr(group)).toBe(true);
  });

  it("is false when any mesh has a non-PBR material (e.g. MeshBasicMaterial)", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    expect(isEveryMeshPbr(group)).toBe(false);
  });

  it("is true (vacuously) for a scene graph with no meshes", () => {
    expect(isEveryMeshPbr(new THREE.Group())).toBe(true);
  });
});
