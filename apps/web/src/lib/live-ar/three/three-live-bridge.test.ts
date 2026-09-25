import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { afterEach, describe, expect, it } from "vitest";

import type { Gltf3dAssetMetadata } from "@/lib/live-ar/jewellery-representation";
import { clearGltfAssetCache } from "@/lib/live-ar/three/three-asset-loader";
import {
  applyLive3dTransform,
  attachmentTypeToTrackedCategory,
  computeLive3dTransform,
  deriveRotationResultFromSmoothedTransform,
  deriveScaleResultFromSmoothedTransform,
  loadLive3dAssetFromMetadata,
  loadLive3dJewelleryAsset,
  resolveGltf3dAssetMetadata,
  type Live3dJewelleryAsset,
} from "@/lib/live-ar/three/three-live-bridge";
import { buildCameraConfig } from "@/lib/live-ar/three/three-camera";
import type { JewelleryAssetGeometry, LiveTransform } from "@/lib/live-ar/types";

const DIAMOND_CHOKER_ID = "b68b76b3-55ba-4808-869c-4d8266f7aff7";

/** A real, self-contained GLB built in-process (never presented as jewellery) --
 * same fixture technique three-asset-loader.test.ts already uses -- so this file's
 * loading/transform tests exercise real GLTFExporter/GLTFLoader bytes without a
 * network fetch to the actual /generated-3d-assets/ path. */
async function buildFixtureGlbDataUrl(): Promise<string> {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ color: "#d4af37", metalness: 1, roughness: 0.35 })));
  const buffer = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  return `data:model/gltf-binary;base64,${Buffer.from(buffer).toString("base64")}`;
}

function fixtureMetadata(overrides: Partial<Gltf3dAssetMetadata> = {}, modelUrl: string): Gltf3dAssetMetadata {
  return {
    modelUrl,
    modelFormat: "glb",
    physicalWidthMm: 190,
    physicalHeightMm: 106,
    physicalDepthMm: 12,
    attachmentType: "neck_choker",
    anchor: { x: 0, y: 0, z: 0 },
    mirrorable: false,
    materialProfile: "pbr-metallic-roughness",
    scaleCorrection: null,
    rotationCorrectionDegrees: null,
    ...overrides,
  };
}

const FIXTURE_ASSET_GEOMETRY: JewelleryAssetGeometry = {
  widthPx: 1200,
  heightPx: 700,
  alphaBbox: [0, 0, 1200, 700],
  anchorPx: { x: 600, y: 0 },
  anchorSource: "default_bbox_top_center",
  mirrorable: false,
  physicalWidthMm: 190,
};

describe("resolveGltf3dAssetMetadata", () => {
  it("resolves the real, registered Diamond Choker id", () => {
    const metadata = resolveGltf3dAssetMetadata(DIAMOND_CHOKER_ID);
    expect(metadata).not.toBeNull();
    expect(metadata!.attachmentType).toBe("neck_choker");
    expect(metadata!.modelFormat).toBe("glb");
  });

  it("returns null for any unregistered id -- the generic 2D-fallback signal", () => {
    expect(resolveGltf3dAssetMetadata("some-other-jewellery-id")).toBeNull();
    expect(resolveGltf3dAssetMetadata("")).toBeNull();
  });
});

describe("attachmentTypeToTrackedCategory", () => {
  it("maps any neck_* attachment to necklace", () => {
    expect(attachmentTypeToTrackedCategory("neck_choker")).toBe("necklace");
    expect(attachmentTypeToTrackedCategory("neck_haaram")).toBe("necklace");
  });

  it("maps any ear_* attachment to earrings", () => {
    expect(attachmentTypeToTrackedCategory("ear_stud")).toBe("earrings");
  });

  it("returns null for attachment types this runtime has no live tracking for (finger/wrist/nose/forehead)", () => {
    expect(attachmentTypeToTrackedCategory("finger")).toBeNull();
    expect(attachmentTypeToTrackedCategory("wrist_left")).toBeNull();
    expect(attachmentTypeToTrackedCategory("nose_ring")).toBeNull();
    expect(attachmentTypeToTrackedCategory("forehead")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(attachmentTypeToTrackedCategory(null)).toBeNull();
  });
});

describe("loadLive3dAssetFromMetadata / loadLive3dJewelleryAsset", () => {
  afterEach(() => {
    clearGltfAssetCache();
  });

  it("loads a real GLB through the EXISTING, unmodified three-asset-loader.ts and measures its bounding box", async () => {
    const url = await buildFixtureGlbDataUrl();
    const asset = await loadLive3dAssetFromMetadata(fixtureMetadata({}, url));
    expect(asset.instance).toBeInstanceOf(THREE.Group);
    expect(asset.boundingBoxWidthMm).toBeCloseTo(2, 1);
  });

  it("two loads of the SAME metadata produce independent clone instances sharing the cached geometry (multiple simultaneous instances)", async () => {
    const url = await buildFixtureGlbDataUrl();
    const metadata = fixtureMetadata({}, url);
    const first = await loadLive3dAssetFromMetadata(metadata);
    const second = await loadLive3dAssetFromMetadata(metadata);
    expect(first.instance).not.toBe(second.instance);
    const firstMesh = first.instance.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
    const secondMesh = second.instance.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
    expect(firstMesh.geometry).toBe(secondMesh.geometry); // shared GPU resource, same as three-asset-loader.test.ts's own contract
  });

  it("loadLive3dJewelleryAsset returns null for an unregistered id -- never throws, never fabricates an asset", async () => {
    const asset = await loadLive3dJewelleryAsset("not-a-real-id");
    expect(asset).toBeNull();
  });

  it("a malformed/unreachable GLB rejects, and does not poison the cache for a subsequent valid load (mirrors three-asset-loader.test.ts's own contract)", async () => {
    const badMetadata = fixtureMetadata({}, "data:model/gltf-binary;base64,dGhpcyBpcyBub3QgYSByZWFsIGdsYg==#bad");
    await expect(loadLive3dAssetFromMetadata(badMetadata)).rejects.toThrow();

    const goodUrl = await buildFixtureGlbDataUrl();
    const asset = await loadLive3dAssetFromMetadata(fixtureMetadata({}, goodUrl));
    expect(asset.instance).toBeInstanceOf(THREE.Group);
  });
});

describe("deriveScaleResultFromSmoothedTransform / deriveRotationResultFromSmoothedTransform", () => {
  const smoothed: LiveTransform = { anchorPx: { x: 320, y: 240 }, scaleFactor: 0.5, rotationDegrees: 7, sourceAnchorPx: { x: 0, y: 0 }, mirrored: false };

  it("recovers targetWidthPx consistent with scaleFactor * effectiveWidthPx (inverting computeScale's own division)", () => {
    const scale = deriveScaleResultFromSmoothedTransform(smoothed, FIXTURE_ASSET_GEOMETRY);
    expect(scale.success).toBe(true);
    expect(scale.targetWidthPx).toBeCloseTo(0.5 * 1200, 6);
    expect(scale.scaleFactor).toBe(0.5);
  });

  it("carries the smoothed rotation through unchanged", () => {
    const rotation = deriveRotationResultFromSmoothedTransform(smoothed);
    expect(rotation.success).toBe(true);
    expect(rotation.rotationDegrees).toBe(7);
  });
});

describe("computeLive3dTransform", () => {
  const smoothed: LiveTransform = { anchorPx: { x: 320, y: 240 }, scaleFactor: 0.5, rotationDegrees: 0, sourceAnchorPx: { x: 0, y: 0 }, mirrored: false };
  const cameraConfig = buildCameraConfig(640, 480);
  let asset: Live3dJewelleryAsset;

  it("returns null when the asset has no physicalWidthMm -- the documented honest limitation, never a fabricated scale", async () => {
    const url = await buildFixtureGlbDataUrl();
    asset = await loadLive3dAssetFromMetadata(fixtureMetadata({ physicalWidthMm: null }, url));
    const transform = computeLive3dTransform(smoothed, asset, FIXTURE_ASSET_GEOMETRY, 0, 640, 480, cameraConfig);
    expect(transform).toBeNull();
    clearGltfAssetCache();
  });

  it("returns a real transform (position/quaternion/scale) when physicalWidthMm is present", async () => {
    const url = await buildFixtureGlbDataUrl();
    asset = await loadLive3dAssetFromMetadata(fixtureMetadata({}, url));
    const transform = computeLive3dTransform(smoothed, asset, FIXTURE_ASSET_GEOMETRY, 0, 640, 480, cameraConfig);
    expect(transform).not.toBeNull();
    expect(Number.isFinite(transform!.positionMm.z)).toBe(true);
    expect(transform!.positionMm.z).toBeLessThan(0); // in front of the camera, per three-types.ts's -Z convention
    expect(transform!.scale).toBeGreaterThan(0);
    clearGltfAssetCache();
  });

  it("a larger yawAsymmetry produces a genuinely different quaternion (orientation actually responds to tracking, Step 10)", async () => {
    const url = await buildFixtureGlbDataUrl();
    asset = await loadLive3dAssetFromMetadata(fixtureMetadata({}, url));
    const straight = computeLive3dTransform(smoothed, asset, FIXTURE_ASSET_GEOMETRY, 0, 640, 480, cameraConfig)!;
    const turned = computeLive3dTransform(smoothed, asset, FIXTURE_ASSET_GEOMETRY, 1, 640, 480, cameraConfig)!;
    expect(turned.quaternion).not.toEqual(straight.quaternion);
    clearGltfAssetCache();
  });
});

describe("applyLive3dTransform", () => {
  it("mutates the instance's position/quaternion/scale from a plain transform object -- pure, no WebGL required", () => {
    const instance = new THREE.Group();
    applyLive3dTransform(instance, { positionMm: { x: 1, y: 2, z: -300 }, quaternion: [0, 0.1, 0, 0.995], scale: 0.42 });
    expect(instance.position.x).toBe(1);
    expect(instance.position.y).toBe(2);
    expect(instance.position.z).toBe(-300);
    expect(instance.quaternion.y).toBeCloseTo(0.1, 6);
    expect(instance.scale.x).toBeCloseTo(0.42, 6);
    expect(instance.scale.y).toBeCloseTo(0.42, 6);
    expect(instance.scale.z).toBeCloseTo(0.42, 6);
  });
});
