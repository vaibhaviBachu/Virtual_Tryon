/**
 * M6.8 3D rendering foundation — PBR material handling (spec Step 12). "Use glTF PBR
 * metallic-roughness... do not simply tint the object yellow... the material must
 * respond to lighting."
 *
 * A real GLB asset (once one exists) is expected to already carry its own
 * `MeshStandardMaterial`/`MeshPhysicalMaterial` from the artist's own PBR authoring
 * (glTF's metallic-roughness workflow maps directly onto Three.js's own material
 * classes via GLTFLoader — nothing needs to be "converted"). This module's job is
 * narrower: verify/normalize whatever material GLTFLoader produced, and provide an
 * EXPLICIT fallback material for the (documented, temporary) case where an asset has
 * no material at all yet — never inventing texture maps the asset doesn't have (spec
 * Step 12's "do not invent texture maps if the actual jewellery asset does not have
 * them").
 */
import * as THREE from "three";

/** A reasonable, restrained gold starting point for `metallic ≈ 1` (spec Step 12) --
 * used ONLY as a fallback when a mesh has no material of its own, never applied on
 * top of / in place of a real authored material. Roughness is deliberately non-zero
 * (a perfectly smooth/roughness=0 metal is an obviously fake, mirror-like look, not a
 * physically plausible one -- spec Step 12's own "use an appropriate roughness rather
 * than forcing zero roughness"). UNCALIBRATED -- a real gold material profile should
 * come from the 3D artist's own authored values (docs/jewellery-3d-asset-spec.md),
 * not this fallback. */
export function createFallbackGoldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color("#d4af37"),
    metalness: 1,
    roughness: 0.35,
  });
}

/** Walks every mesh in a loaded GLB's scene graph and assigns the fallback material to
 * any mesh that has NONE (a bare/placeholder mesh with no material at all) -- meshes
 * that already have a real material (the expected, normal case for a properly
 * authored glTF PBR asset) are left completely untouched. Returns the count of meshes
 * that received the fallback, purely so a caller/log can report honestly whether a
 * given asset actually needed it (0 for a properly authored asset). */
export function applyFallbackMaterialWhereMissing(root: THREE.Object3D): number {
  let fallbackCount = 0;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node.material) return;
    node.material = createFallbackGoldMaterial();
    fallbackCount += 1;
  });
  return fallbackCount;
}

/** Confirms every mesh in the scene graph carries a PBR-capable material
 * (`MeshStandardMaterial`/`MeshPhysicalMaterial` -- the two Three.js classes
 * GLTFLoader ever produces for glTF's metallic-roughness materials) rather than some
 * other, non-PBR material type. Used as a real, testable "did this asset actually
 * come through with PBR materials" check, never assumed. */
export function isEveryMeshPbr(root: THREE.Object3D): boolean {
  let allPbr = true;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (!(node.material instanceof THREE.MeshStandardMaterial) && !(node.material instanceof THREE.MeshPhysicalMaterial)) {
      allPbr = false;
    }
  });
  return allPbr;
}
