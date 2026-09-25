import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { countTriangles, realizeComponentTree } from "@/lib/jewellery-3d-generator/component";
import type { JewelleryComponent } from "@/lib/jewellery-3d-generator/types";

describe("realizeComponentTree", () => {
  it("a component with geometry becomes a Mesh, named and positioned correctly", () => {
    const component: JewelleryComponent = {
      name: "band",
      geometry: new THREE.BoxGeometry(1, 1, 1),
      materialId: "gold",
      position: { x: 1, y: 2, z: 3 },
      children: [],
    };
    const materials = new Map<string, THREE.Material>([["gold", new THREE.MeshStandardMaterial()]]);
    const group = realizeComponentTree(component, materials);
    expect(group.position.x).toBe(1);
    expect(group.position.y).toBe(2);
    expect(group.position.z).toBe(3);
    const mesh = group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(mesh).toBeDefined();
    expect(mesh!.material).toBe(materials.get("gold"));
  });

  it("a component with geometry: null is a pure organizational group -- no mesh", () => {
    const component: JewelleryComponent = { name: "drops", geometry: null, materialId: null, position: { x: 0, y: 0, z: 0 }, children: [] };
    const group = realizeComponentTree(component, new Map());
    expect(group.children.some((c) => c instanceof THREE.Mesh)).toBe(false);
  });

  it("children are recursively realized and nested under the parent group", () => {
    const child: JewelleryComponent = { name: "child", geometry: new THREE.BoxGeometry(1, 1, 1), materialId: null, position: { x: 5, y: 0, z: 0 }, children: [] };
    const root: JewelleryComponent = { name: "root", geometry: null, materialId: null, position: { x: 0, y: 0, z: 0 }, children: [child] };
    const group = realizeComponentTree(root, new Map());
    expect(group.children).toHaveLength(1);
    expect(group.children[0].name).toBe("child");
    expect(group.children[0].position.x).toBe(5);
  });

  it("rotationDegrees is applied as a real quaternion, not left identity", () => {
    const component: JewelleryComponent = {
      name: "tilted",
      geometry: null,
      materialId: null,
      position: { x: 0, y: 0, z: 0 },
      rotationDegrees: { yawDegrees: 90, pitchDegrees: 0, rollDegrees: 0 },
      children: [],
    };
    const group = realizeComponentTree(component, new Map());
    expect(group.quaternion.equals(new THREE.Quaternion())).toBe(false);
  });

  it("throws a clear error when materialId references a material not in the map (never silently falls back)", () => {
    const component: JewelleryComponent = { name: "band", geometry: new THREE.BoxGeometry(1, 1, 1), materialId: "missing", position: { x: 0, y: 0, z: 0 }, children: [] };
    expect(() => realizeComponentTree(component, new Map())).toThrow(/missing/);
  });
});

describe("countTriangles", () => {
  it("a single box mesh has exactly 12 triangles", () => {
    const group = realizeComponentTree(
      { name: "box", geometry: new THREE.BoxGeometry(1, 1, 1), materialId: null, position: { x: 0, y: 0, z: 0 }, children: [] },
      new Map()
    );
    expect(countTriangles(group)).toBe(12);
  });

  it("sums across multiple nested meshes", () => {
    const group = realizeComponentTree(
      {
        name: "root",
        geometry: new THREE.BoxGeometry(1, 1, 1),
        materialId: null,
        position: { x: 0, y: 0, z: 0 },
        children: [{ name: "child", geometry: new THREE.BoxGeometry(1, 1, 1), materialId: null, position: { x: 0, y: 0, z: 0 }, children: [] }],
      },
      new Map()
    );
    expect(countTriangles(group)).toBe(24);
  });
});
