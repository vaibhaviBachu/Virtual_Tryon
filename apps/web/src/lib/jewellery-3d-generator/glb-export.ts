/**
 * Phase D Step 9 — generic GLB export pipeline:
 *   specification -> category strategy -> component tree -> THREE.Group -> GLTFExporter -> .glb
 *
 * Uses ONLY `three@0.186.1` (already installed) and its own `GLTFExporter`, via the
 * EXACT technique this repository already proved works, entirely offline, in
 * `three-asset-loader.test.ts` (`new GLTFExporter().parseAsync(scene, { binary: true })`).
 * No new dependency. This module is the ONLY caller of `GLTFExporter` in the whole
 * generator -- every category strategy produces a plain `JewelleryComponent` tree,
 * never touches the exporter itself.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { realizeComponentTree } from "@/lib/jewellery-3d-generator/component";
import { buildMaterialMap } from "@/lib/jewellery-3d-generator/materials";
import { getCategoryStrategy } from "@/lib/jewellery-3d-generator/strategies/registry";
import type { Jewellery3DSpecification } from "@/lib/jewellery-3d-generator/types";

export interface GeneratedJewellery3DAsset {
  spec: Jewellery3DSpecification;
  /** The realized scene graph, in case a caller (a test, or this module's own
   * validation helpers) wants to inspect it directly before/instead of exporting. */
  group: THREE.Group;
  /** A real binary GLB. */
  glb: ArrayBuffer;
}

/** The system's single public entry point (Phase D's own
 * `generateJewellery3D(specification)`). Never category-specific -- the ONLY branch
 * on `spec.category` anywhere in this call chain is the strategy lookup itself. */
export async function generateJewellery3D(spec: Jewellery3DSpecification): Promise<GeneratedJewellery3DAsset> {
  const strategy = getCategoryStrategy(spec.category);
  const componentTree = strategy.buildComponentTree(spec);
  const materials = buildMaterialMap(spec.materials);
  const group = realizeComponentTree(componentTree, materials);

  const scene = new THREE.Scene();
  scene.add(group);
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;

  return { spec, group, glb };
}

/** Converts a real, in-memory GLB into a `data:` URL -- the exact fixture technique
 * `three-asset-loader.test.ts` already uses to exercise the real `GLTFLoader`
 * offline. Exposed here so tests/tools never duplicate the base64-encoding logic. */
export function glbToDataUrl(glb: ArrayBuffer): string {
  const base64 = Buffer.from(glb).toString("base64");
  return `data:model/gltf-binary;base64,${base64}`;
}
