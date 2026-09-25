import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildMaterialMap, createJewelleryMaterial } from "@/lib/jewellery-3d-generator/materials";

describe("createJewelleryMaterial", () => {
  it("gold is a real PBR MeshStandardMaterial with metalness ~1", () => {
    const material = createJewelleryMaterial({ id: "g", preset: "gold" }) as THREE.MeshStandardMaterial;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.metalness).toBe(1);
  });

  it("diamond is MeshPhysicalMaterial with zero metalness and real transmission", () => {
    const material = createJewelleryMaterial({ id: "d", preset: "diamond" }) as THREE.MeshPhysicalMaterial;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.metalness).toBe(0);
    expect(material.transmission).toBeGreaterThan(0);
  });

  it("gemstone is MeshPhysicalMaterial, distinct defaults from diamond", () => {
    const material = createJewelleryMaterial({ id: "s", preset: "gemstone" }) as THREE.MeshPhysicalMaterial;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.ior).not.toBe(2.4);
  });

  it("silver/platinum/polished-metal/brushed-metal are all real PBR metals", () => {
    for (const preset of ["silver", "platinum", "polished-metal", "brushed-metal"] as const) {
      const material = createJewelleryMaterial({ id: preset, preset }) as THREE.MeshStandardMaterial;
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material.metalness).toBeGreaterThan(0);
    }
  });

  it("overrides (color/metalness/roughness) are actually applied, not ignored", () => {
    const material = createJewelleryMaterial({ id: "g", preset: "gold", colorHex: "#123456", metalnessOverride: 0.5, roughnessOverride: 0.9 }) as THREE.MeshStandardMaterial;
    expect(material.metalness).toBe(0.5);
    expect(material.roughness).toBe(0.9);
    expect(material.color.getHexString()).toBe("123456");
  });
});

describe("buildMaterialMap", () => {
  it("builds a lookup keyed by MaterialSpec.id, one real material per entry", () => {
    const map = buildMaterialMap([
      { id: "gold", preset: "gold" },
      { id: "diamond", preset: "diamond" },
    ]);
    expect(map.size).toBe(2);
    expect(map.get("gold")).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(map.get("diamond")).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });
});
