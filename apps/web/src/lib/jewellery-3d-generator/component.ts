/**
 * Phase D Step 5 — generic component system. Turns the plain-data
 * `JewelleryComponent` tree a category strategy builds into a real `THREE.Group`
 * scene graph, by walking it once. This is the ONLY place `THREE.Mesh`/`THREE.Group`
 * instances get created from a component tree -- no category strategy constructs
 * Three.js scene-graph nodes directly, so the renderer-facing shape (a `THREE.Group`,
 * exactly what `three-asset-loader.ts` already expects from a loaded GLB's `.scene`)
 * is decided once, here.
 */
import * as THREE from "three";

import type { JewelleryComponent } from "@/lib/jewellery-3d-generator/types";

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Recursively realizes one component (and its children) into a `THREE.Group`. A
 * component with `geometry: null` becomes a pure organizational group (e.g. a
 * "drops" node holding many individual drop children) with no mesh of its own. */
export function realizeComponentTree(component: JewelleryComponent, materials: Map<string, THREE.Material>): THREE.Group {
  const group = new THREE.Group();
  group.name = component.name;
  group.position.set(component.position.x, component.position.y, component.position.z);

  if (component.rotationDegrees) {
    const euler = new THREE.Euler(
      degToRad(component.rotationDegrees.pitchDegrees),
      degToRad(component.rotationDegrees.yawDegrees),
      degToRad(component.rotationDegrees.rollDegrees),
      "YXZ"
    );
    group.quaternion.setFromEuler(euler);
  }

  if (component.geometry) {
    const material = component.materialId ? materials.get(component.materialId) : undefined;
    if (component.materialId && !material) {
      throw new Error(`Component "${component.name}" references materialId "${component.materialId}", which is not in the provided material map.`);
    }
    const mesh = new THREE.Mesh(component.geometry, material ?? new THREE.MeshStandardMaterial());
    mesh.name = component.name;
    group.add(mesh);
  }

  for (const child of component.children) {
    group.add(realizeComponentTree(child, materials));
  }

  return group;
}

/** Counts every mesh's triangle count across a realized (or any) `Object3D` graph --
 * used by tests/reporting to verify the generator stays within its triangle budget,
 * without duplicating that walk logic at every call site. */
export function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute("position");
    const indexCount = node.geometry.getIndex()?.count;
    total += (indexCount ?? position.count) / 3;
  });
  return total;
}
