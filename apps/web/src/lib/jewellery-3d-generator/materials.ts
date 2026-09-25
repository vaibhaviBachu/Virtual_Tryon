/**
 * Phase D Step 6 — generic jewellery material system. Reuses
 * `three-materials.ts`'s existing `createFallbackGoldMaterial` as the gold preset's
 * base values (Phase D's own instruction: "reuse existing material infrastructure
 * where appropriate... do not create material logic specifically for the Diamond
 * Choker") rather than duplicating its color/metalness/roughness literals here.
 */
import * as THREE from "three";

import { createFallbackGoldMaterial } from "@/lib/live-ar/three/three-materials";
import type { MaterialSpec } from "@/lib/jewellery-3d-generator/types";

function applyOverrides(material: THREE.MeshStandardMaterial, spec: MaterialSpec): THREE.MeshStandardMaterial {
  if (spec.colorHex) material.color = new THREE.Color(spec.colorHex);
  if (spec.metalnessOverride !== undefined) material.metalness = spec.metalnessOverride;
  if (spec.roughnessOverride !== undefined) material.roughness = spec.roughnessOverride;
  return material;
}

/** Builds one real glTF-exportable PBR material for a `MaterialSpec`. Every preset
 * maps onto `MeshStandardMaterial`/`MeshPhysicalMaterial` -- the same two classes
 * `three-materials.ts`'s `isEveryMeshPbr` already recognizes as "real PBR," so a
 * generated asset's materials pass that existing check with no changes to it. */
export function createJewelleryMaterial(spec: MaterialSpec): THREE.Material {
  switch (spec.preset) {
    case "gold":
      return applyOverrides(createFallbackGoldMaterial(), spec);
    case "silver":
      return applyOverrides(new THREE.MeshStandardMaterial({ color: "#c0c0c0", metalness: 1, roughness: 0.3 }), spec);
    case "platinum":
      return applyOverrides(new THREE.MeshStandardMaterial({ color: "#e5e4e2", metalness: 1, roughness: 0.25 }), spec);
    case "polished-metal":
      return applyOverrides(createFallbackGoldMaterial(), { ...spec, roughnessOverride: spec.roughnessOverride ?? 0.12 });
    case "brushed-metal":
      return applyOverrides(createFallbackGoldMaterial(), { ...spec, roughnessOverride: spec.roughnessOverride ?? 0.55 });
    case "diamond":
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(spec.colorHex ?? "#ffffff"),
        metalness: 0,
        roughness: spec.roughnessOverride ?? 0.05,
        transmission: 0.9,
        ior: 2.4,
        thickness: 0.5,
      });
    case "gemstone":
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(spec.colorHex ?? "#3b82f6"),
        metalness: 0,
        roughness: spec.roughnessOverride ?? 0.1,
        transmission: 0.5,
        ior: 1.7,
      });
  }
}

/** Builds a `MaterialSpec.id -> THREE.Material` lookup for a whole specification's
 * material list -- the shared map `component.ts`'s `realizeComponentTree` resolves
 * every component's `materialId` against. */
export function buildMaterialMap(specs: MaterialSpec[]): Map<string, THREE.Material> {
  return new Map(specs.map((spec) => [spec.id, createJewelleryMaterial(spec)]));
}
