import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { SurfaceOrientation } from "@/lib/live-ar/three/body-attachment";
import { buildCameraConfig } from "@/lib/live-ar/three/three-camera";
import { buildCurved25dAsset, resolveCurved25dAssetMetadata } from "@/lib/live-ar/three/curved-2_5d-bridge";
import { computeSurfaceAttachedTransformFromDimensions } from "@/lib/live-ar/three/three-live-bridge";
import type { JewelleryAssetGeometry, LiveTransform } from "@/lib/live-ar/types";

const DIAMOND_CHOKER_ID = "b68b76b3-55ba-4808-869c-4d8266f7aff7";

describe("resolveCurved25dAssetMetadata", () => {
  it("resolves the real, production-verified Diamond Choker curved-2.5d entry", () => {
    const metadata = resolveCurved25dAssetMetadata(DIAMOND_CHOKER_ID);
    expect(metadata).not.toBeNull();
    expect(metadata!.attachmentType).toBe("neck_choker");
    expect(metadata!.physicalWidthMm).toBe(190);
    expect(metadata!.curveControlPointsMm).toHaveLength(3);
  });

  it("returns null for any unregistered id", () => {
    expect(resolveCurved25dAssetMetadata("not-a-real-id")).toBeNull();
  });
});

describe("buildCurved25dAsset", () => {
  it("builds a real THREE.Group containing exactly one textured Mesh, using the REAL provided image as the texture source (never a second fetch)", () => {
    const metadata = resolveCurved25dAssetMetadata(DIAMOND_CHOKER_ID)!;
    const image = {} as HTMLImageElement; // construction-only fixture -- see this file's own docstring
    const asset = buildCurved25dAsset(metadata, image);
    expect(asset.instance).toBeInstanceOf(THREE.Group);
    const mesh = asset.instance.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(mesh).toBeDefined();
    expect(mesh!.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    const material = mesh!.material as THREE.MeshBasicMaterial;
    expect(material.map).toBeInstanceOf(THREE.Texture);
    expect(material.map!.image).toBe(image); // the SAME image object, not a copy/refetch
    expect(material.transparent).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
  });

  it("the measured bounding-box width is close to the item's own physicalWidthMm (the ribbon is built at that width)", () => {
    const metadata = resolveCurved25dAssetMetadata(DIAMOND_CHOKER_ID)!;
    const asset = buildCurved25dAsset(metadata, {} as HTMLImageElement);
    expect(asset.boundingBoxWidthMm).toBeGreaterThan(180);
    expect(asset.boundingBoxWidthMm).toBeLessThan(200);
  });

  it("real geometry has real depth (Z) extent, proving the curve is actually followed, not a flat plane", () => {
    const metadata = resolveCurved25dAssetMetadata(DIAMOND_CHOKER_ID)!;
    const asset = buildCurved25dAsset(metadata, {} as HTMLImageElement);
    const box = new THREE.Box3().setFromObject(asset.instance);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(10);
    expect(size.y).toBeCloseTo(106, 0);
  });
});

describe("computeSurfaceAttachedTransformFromDimensions (reused by the curved-2.5d path)", () => {
  const smoothed: LiveTransform = { anchorPx: { x: 320, y: 240 }, scaleFactor: 0.5, rotationDegrees: 0, sourceAnchorPx: { x: 0, y: 0 }, mirrored: false };
  const cameraConfig = buildCameraConfig(640, 480);
  const assetGeometry: JewelleryAssetGeometry = {
    widthPx: 1200,
    heightPx: 700,
    alphaBbox: [0, 0, 1200, 700],
    anchorPx: { x: 600, y: 0 },
    anchorSource: "default_bbox_top_center",
    mirrorable: false,
    physicalWidthMm: 190,
  };
  const neutralOrientation: SurfaceOrientation = { yawRadians: 0, pitchRadians: 0, rollRadians: 0, confidence: 1, method: "shoulder_roll_plus_real_facial_transform_matrix" };

  it("produces a real transform for the ribbon's own (physicalWidthMm, physicalDepthMm, boundingBoxWidthMm)", () => {
    const transform = computeSurfaceAttachedTransformFromDimensions(smoothed, 190, 12, 192.2, assetGeometry, neutralOrientation, 640, 480, cameraConfig);
    expect(transform).not.toBeNull();
    expect(transform!.positionMm.z).toBeLessThan(0);
    expect(transform!.scale).toBeGreaterThan(0);
    // boundingBoxWidthMm (192.2) is slightly larger than physicalWidthMm (190) --
    // the resulting scale should be slightly less than 1, a real, small correction.
    expect(transform!.scale).toBeLessThan(1);
    expect(transform!.scale).toBeGreaterThan(0.9);
  });

  it("returns null when physicalWidthMm is null -- same honest limitation as the GLB path", () => {
    expect(computeSurfaceAttachedTransformFromDimensions(smoothed, null, 12, 190, assetGeometry, neutralOrientation, 640, 480, cameraConfig)).toBeNull();
  });

  /** Synthetic orientation coverage (docs/2-5d-jewellery-surface-attachment.md Step
   * 19): front, left/right yaw at several magnitudes, pitch up/down, and roll --
   * exercised as pure transform math here (this module's own real-browser
   * verification separately confirmed these orientations produce a genuinely
   * different, non-flat-sticker render -- see that doc's "Real-browser
   * verification" section). Each case asserts the transform is real (non-null,
   * finite) and that the ROTATION actually varies with the input -- i.e. this is
   * not silently falling back to an identity/neutral transform for any of them. */
  function orientationOf(yawDeg: number, pitchDeg: number, rollDeg: number): SurfaceOrientation {
    return {
      yawRadians: (yawDeg * Math.PI) / 180,
      pitchRadians: (pitchDeg * Math.PI) / 180,
      rollRadians: (rollDeg * Math.PI) / 180,
      confidence: 1,
      method: "shoulder_roll_plus_real_facial_transform_matrix",
    };
  }

  const YAW_CASES_DEG = [0, 15, -15, 30, -30, 45, -45];
  it.each(YAW_CASES_DEG)("produces a real, finite transform at yaw=%d deg (front/left/right)", (yawDeg) => {
    const transform = computeSurfaceAttachedTransformFromDimensions(smoothed, 190, 12, 192.2, assetGeometry, orientationOf(yawDeg, 0, 0), 640, 480, cameraConfig);
    expect(transform).not.toBeNull();
    expect(Number.isFinite(transform!.positionMm.x)).toBe(true);
    expect(Number.isFinite(transform!.positionMm.z)).toBe(true);
    expect(transform!.quaternion.every(Number.isFinite)).toBe(true);
    // yaw is rotation about Y -- the quaternion's y component should carry its sign.
    if (yawDeg > 0) expect(transform!.quaternion[1]).toBeGreaterThan(0);
    if (yawDeg < 0) expect(transform!.quaternion[1]).toBeLessThan(0);
    if (yawDeg === 0) expect(transform!.quaternion[1]).toBeCloseTo(0, 10);
  });

  const PITCH_CASES_DEG = [15, -15, 25, -25];
  it.each(PITCH_CASES_DEG)("produces a real, finite transform at pitch=%d deg (up/down)", (pitchDeg) => {
    const transform = computeSurfaceAttachedTransformFromDimensions(smoothed, 190, 12, 192.2, assetGeometry, orientationOf(0, pitchDeg, 0), 640, 480, cameraConfig);
    expect(transform).not.toBeNull();
    expect(transform!.quaternion.every(Number.isFinite)).toBe(true);
    if (pitchDeg > 0) expect(transform!.quaternion[0]).toBeGreaterThan(0);
    if (pitchDeg < 0) expect(transform!.quaternion[0]).toBeLessThan(0);
  });

  const ROLL_CASES_DEG = [10, -10, 20];
  it.each(ROLL_CASES_DEG)("produces a real, finite transform at roll=%d deg (head tilt)", (rollDeg) => {
    const transform = computeSurfaceAttachedTransformFromDimensions(smoothed, 190, 12, 192.2, assetGeometry, orientationOf(0, 0, rollDeg), 640, 480, cameraConfig);
    expect(transform).not.toBeNull();
    expect(transform!.quaternion.every(Number.isFinite)).toBe(true);
    if (rollDeg > 0) expect(transform!.quaternion[2]).toBeGreaterThan(0);
    if (rollDeg < 0) expect(transform!.quaternion[2]).toBeLessThan(0);
  });

  it("camera closer (larger scaleFactor) moves the mesh nearer the camera (less negative-magnitude z) than camera farther (smaller scaleFactor)", () => {
    const closer: LiveTransform = { ...smoothed, scaleFactor: 0.8 };
    const farther: LiveTransform = { ...smoothed, scaleFactor: 0.2 };
    const closerTransform = computeSurfaceAttachedTransformFromDimensions(closer, 190, 12, 192.2, assetGeometry, neutralOrientation, 640, 480, cameraConfig);
    const fartherTransform = computeSurfaceAttachedTransformFromDimensions(farther, 190, 12, 192.2, assetGeometry, neutralOrientation, 640, 480, cameraConfig);
    expect(closerTransform).not.toBeNull();
    expect(fartherTransform).not.toBeNull();
    // Both are negative (in front of the camera) -- "closer" means smaller |z|.
    expect(Math.abs(closerTransform!.positionMm.z)).toBeLessThan(Math.abs(fartherTransform!.positionMm.z));
  });

  it("shoulder/head movement (a shifted anchorPx, same scale/orientation) shifts the mesh's screen-space position without breaking the transform", () => {
    const shifted: LiveTransform = { ...smoothed, anchorPx: { x: 460, y: 300 } };
    const base = computeSurfaceAttachedTransformFromDimensions(smoothed, 190, 12, 192.2, assetGeometry, neutralOrientation, 640, 480, cameraConfig);
    const moved = computeSurfaceAttachedTransformFromDimensions(shifted, 190, 12, 192.2, assetGeometry, neutralOrientation, 640, 480, cameraConfig);
    expect(base).not.toBeNull();
    expect(moved).not.toBeNull();
    expect(moved!.positionMm.x).not.toBeCloseTo(base!.positionMm.x, 3);
  });

  it("low-confidence/degraded orientation (tracking degradation) still produces a real transform -- confidence gates DOWNSTREAM blending/fallback decisions, never this function itself", () => {
    const degraded: SurfaceOrientation = { yawRadians: 0.2, pitchRadians: 0, rollRadians: 0, confidence: 0.05, method: "shoulder_roll_plus_2d_yaw_proxy_fallback" };
    const transform = computeSurfaceAttachedTransformFromDimensions(smoothed, 190, 12, 192.2, assetGeometry, degraded, 640, 480, cameraConfig);
    expect(transform).not.toBeNull();
    expect(transform!.quaternion.every(Number.isFinite)).toBe(true);
  });
});
