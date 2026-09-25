import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";

import { countTriangles } from "@/lib/jewellery-3d-generator/component";
import { buildDiamondChokerSpecification } from "@/lib/jewellery-3d-generator/fixtures/diamond-choker-spec";
import { buildRingSpecification } from "@/lib/jewellery-3d-generator/fixtures/ring-spec";
import { generateJewellery3D, glbToDataUrl } from "@/lib/jewellery-3d-generator/glb-export";
import type { Jewellery3DSpecification } from "@/lib/jewellery-3d-generator/types";
import { resolveJewelleryRepresentation } from "@/lib/live-ar/jewellery-representation";
import { clearGltfAssetCache, loadGltfAsset } from "@/lib/live-ar/three/three-asset-loader";
import { isEveryMeshPbr } from "@/lib/live-ar/three/three-materials";

/** Real, non-mocked "is this a flat billboard" check (Phase D Step 14/16 item 10):
 * positive extent in every axis, and at least two meaningfully different vertex
 * normal directions somewhere in the whole assembly (a flat plane's normals are all
 * identical). */
function hasGenuine3DVolume(root: THREE.Object3D): boolean {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 1 && size.y > 1 && size.z > 1)) return false;

  const normals: THREE.Vector3[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const attr = node.geometry.getAttribute("normal");
    if (attr) normals.push(new THREE.Vector3(attr.getX(0), attr.getY(0), attr.getZ(0)));
  });
  const first = normals[0];
  return normals.some((n) => first.angleTo(n) > 0.05);
}

describe.each([
  ["Diamond Choker (necklace family, OPEN curve)", buildDiamondChokerSpecification],
  ["Synthetic Ring (CLOSED curve, structurally different topology)", buildRingSpecification],
])("generateJewellery3D -- %s", (_label, buildSpec) => {
  afterEach(() => {
    clearGltfAssetCache();
  });

  it("produces real 3D geometry with genuine volume -- not a PNG billboard", async () => {
    const asset = await generateJewellery3D(buildSpec());
    expect(hasGenuine3DVolume(asset.group)).toBe(true);
  });

  it("every mesh carries a real glTF PBR material", async () => {
    const asset = await generateJewellery3D(buildSpec());
    expect(isEveryMeshPbr(asset.group)).toBe(true);
  });

  it("exports a real, non-empty binary GLB", async () => {
    const asset = await generateJewellery3D(buildSpec());
    expect(asset.glb).toBeInstanceOf(ArrayBuffer);
    expect(asset.glb.byteLength).toBeGreaterThan(0);
  });

  it("the exported GLB round-trips through the EXISTING, unmodified GLTFLoader/three-asset-loader.ts", async () => {
    const asset = await generateJewellery3D(buildSpec());
    const url = glbToDataUrl(asset.glb);
    const loaded = await loadGltfAsset(url);
    expect(loaded.scene).toBeInstanceOf(THREE.Group);
    expect(loaded.boundingBox.isEmpty()).toBe(false);
    const size = loaded.boundingBox.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(0);
    expect(size.y).toBeGreaterThan(0);
    expect(size.z).toBeGreaterThan(0);
  });

  it("stays comfortably within the existing ~20,000-triangle asset-spec ceiling", async () => {
    const asset = await generateJewellery3D(buildSpec());
    const triangles = countTriangles(asset.group);
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThan(20_000);
  });

  it("is consumable by the EXISTING, unmodified Gltf3dAssetMetadata / resolveJewelleryRepresentation contract", async () => {
    const spec = buildSpec();
    const asset = await generateJewellery3D(spec);
    const url = glbToDataUrl(asset.glb);
    const representation = resolveJewelleryRepresentation({
      flatAsset: null,
      gltf3dAsset: {
        modelUrl: url,
        modelFormat: "glb",
        physicalWidthMm: spec.dimensions.widthMm,
        physicalHeightMm: spec.dimensions.heightMm,
        physicalDepthMm: spec.dimensions.depthMm,
        attachmentType: spec.attachment.type,
        anchor: spec.attachment.pointLocal,
        mirrorable: spec.symmetry.mirrored,
        materialProfile: "pbr-metallic-roughness",
        scaleCorrection: null,
        rotationCorrectionDegrees: null,
        // Testing the CONTRACT/plumbing ("a generated asset, once marked verified,
        // is consumable by resolveJewelleryRepresentation") -- not a claim that
        // Phase D's own generated output should ever actually reach a customer;
        // see docs/diamond-choker-asset-restoration.md.
        productionVerified: true,
      },
    });
    expect(representation.type).toBe("gltf-3d");
  });
});

describe("resolveJewelleryRepresentation -- existing 2D fallback is untouched", () => {
  it("still resolves to flat-2d when no 3D asset is given, exactly as before this phase", () => {
    const representation = resolveJewelleryRepresentation({ flatAsset: null });
    expect(representation.type).toBe("flat-2d");
  });
});

describe("physical scale consistency (Diamond Choker)", () => {
  it("the generated Diamond Choker's own width matches the specification's declared physical_width_mm closely", async () => {
    const spec: Jewellery3DSpecification = buildDiamondChokerSpecification();
    const asset = await generateJewellery3D(spec);
    const box = new THREE.Box3().setFromObject(asset.group);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.abs(size.x - spec.dimensions.widthMm)).toBeLessThan(spec.dimensions.widthMm * 0.1);
  });

  it("the generated height is consistent with band_thickness + drop_length (the same internal-consistency identity the measurement spec itself already asserts)", async () => {
    const spec: Jewellery3DSpecification = buildDiamondChokerSpecification();
    const asset = await generateJewellery3D(spec);
    const box = new THREE.Box3().setFromObject(asset.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(spec.band!.crossSection.widthMm);
    expect(size.y).toBeLessThan(spec.dimensions.heightMm * 1.2);
  });

  it("the assembled piece has MORE depth than the band's own cross-section thickness alone -- the wrap curvature and the raised pendant genuinely add real depth, not zero", async () => {
    const spec: Jewellery3DSpecification = buildDiamondChokerSpecification();
    const asset = await generateJewellery3D(spec);
    const box = new THREE.Box3().setFromObject(asset.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(spec.band!.crossSection.depthMm);
  });
});
