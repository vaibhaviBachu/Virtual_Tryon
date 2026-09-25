/**
 * Phase 2.5D (docs/2-5d-jewellery-surface-attachment.md) — the bridge between the
 * REAL, already-loaded jewellery artwork (the same `HTMLImageElement` the existing
 * 2D pipeline already decoded -- `asset-cache.ts`'s `loadJewelleryAssetTexture`,
 * never re-fetched here) and a real, curved, textured Three.js mesh.
 *
 * WHY THIS EXISTS: Phase D's procedural generator produces real 3D geometry, but
 * with placeholder primitives (a plain band, a dome, cones) standing in for the
 * actual jewellery design -- confirmed, via a real-person test, to be unacceptable
 * as a customer-facing representation (docs/diamond-choker-asset-restoration.md).
 * This module takes the opposite trade-off: the texture is the REAL, unaltered
 * artwork (every diamond, the actual central stone, the actual drop shapes --
 * nothing about the source PNG changes), and only the GEOMETRY is synthetic (a
 * curved ribbon, `curved-2_5d-geometry.ts`) -- giving real curvature/perspective/
 * wrap behaviour without fabricating the jewellery's own appearance.
 *
 * REUSES, RATHER THAN DUPLICATES: the persistent WebGL2 runtime
 * (`ThreeLiveRuntime`), the position/orientation/scale math
 * (`computeSurfaceAttachedTransformFromDimensions`), and the render/composite step
 * (`renderInstanceWithTransform`) are ALL `three-live-bridge.ts`'s existing,
 * already-tested functions -- this module adds no second implementation of any of
 * them. The only genuinely new code is asset construction (build a ribbon mesh
 * from a real image) and this module's own registry/resolver, mirroring
 * `three-live-bridge.ts`'s `GLTF_3D_ASSET_REGISTRY`/`resolveGltf3dAssetMetadata`
 * pattern (and the SAME `productionVerified` field, imported from
 * `jewellery-representation.ts`, never a second gating mechanism).
 */
import * as THREE from "three";

import type { SurfaceOrientation } from "@/lib/live-ar/three/body-attachment";
import { buildCameraConfig, updateCameraForViewport } from "@/lib/live-ar/three/three-camera";
import { createCurvedRibbonGeometry } from "@/lib/live-ar/three/curved-2_5d-geometry";
import { resizeThreeRenderer } from "@/lib/live-ar/three/three-renderer";
import {
  computeSurfaceAttachedTransformFromDimensions,
  renderInstanceWithTransform,
  type ThreeLiveRuntime,
} from "@/lib/live-ar/three/three-live-bridge";
import type { JewelleryAssetGeometry, LiveTransform } from "@/lib/live-ar/types";
import type { Curved25dAssetMetadata } from "@/lib/live-ar/jewellery-representation";

export type { Curved25dAssetMetadata };

const CURVED_25D_ASSET_REGISTRY: Record<string, Curved25dAssetMetadata> = {
  "b68b76b3-55ba-4808-869c-4d8266f7aff7": {
    attachmentType: "neck_choker",
    // Same real, already-measured/derived numbers as
    // docs/diamond-choker-prototype-measurements.json -- physicalDepthMm and the
    // curve's own sagitta are still prototype_estimated (never claimed as
    // catalogue-verified), but the WIDTH/HEIGHT/CURVE-SHAPE are the same real
    // numbers already used for the (now dev-only) procedural prototype.
    physicalWidthMm: 190,
    physicalHeightMm: 106,
    physicalDepthMm: 12,
    curveControlPointsMm: [
      { x: -95, y: 0, z: -18 },
      { x: 0, y: 0, z: 0 },
      { x: 95, y: 0, z: -18 },
    ],
    curveClosed: false,
    mirrorable: false,
    // Unlike the procedural prototype, this uses the REAL restored artwork, not a
    // placeholder -- enabled for the upcoming real-person test (docs/
    // 2-5d-jewellery-surface-attachment.md). If that test shows it does not look
    // right, the same one-line revert (false) restores flat-2d immediately.
    productionVerified: true,
  },
};

/** The CUSTOMER-FACING lookup -- mirrors `resolveGltf3dAssetMetadata`'s exact
 * contract and gating discipline. */
export function resolveCurved25dAssetMetadata(jewelleryId: string): Curved25dAssetMetadata | null {
  const metadata = CURVED_25D_ASSET_REGISTRY[jewelleryId];
  if (!metadata || !metadata.productionVerified) return null;
  return metadata;
}

export interface Live25dJewelleryAsset {
  metadata: Curved25dAssetMetadata;
  /** A `THREE.Group` wrapping one `THREE.Mesh` (the curved ribbon + the real
   * image texture) -- built ONCE per item, never per frame (Step 22). */
  instance: THREE.Group;
  /** The ribbon's own real, measured bounding-box width -- computed from the
   * ACTUAL built geometry (not assumed equal to `physicalWidthMm`), exactly
   * mirroring how the GLB path measures `loaded.boundingBox` rather than trusting
   * an assumed scale. In practice very close to `physicalWidthMm` (the ribbon is
   * built at that width), so `computeMeshScaleFactor` ends up applying a
   * near-1.0 correction -- real, not fabricated. */
  boundingBoxWidthMm: number;
}

/**
 * Builds the curved ribbon mesh from a real, already-loaded jewellery image
 * (reuses the SAME `HTMLImageElement` the existing 2D pipeline already decoded --
 * `asset-cache.ts`, never a second fetch/decode) and this module's own metadata.
 * Pure Three.js object construction -- safe to call in a real browser; NOT
 * exercised by `vitest run` only insofar as `THREE.Texture`'s actual GPU upload
 * requires a real WebGL2 context to ever be USED (construction itself needs
 * none, and IS covered by this module's own tests).
 */
export function buildCurved25dAsset(metadata: Curved25dAssetMetadata, image: HTMLImageElement): Live25dJewelleryAsset {
  const geometry = createCurvedRibbonGeometry({
    controlPointsMm: metadata.curveControlPointsMm,
    closed: metadata.curveClosed,
    heightMm: metadata.physicalHeightMm,
    segmentsU: metadata.segmentsU,
    segmentsV: metadata.segmentsV,
  });

  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  // `flipY = false`: THREE.Texture's DEFAULT (flipY = true) flips the image during
  // GPU upload so that UV v=0 samples the source image's BOTTOM row, not its top
  // (the opposite of the intuitive reading -- confirmed the hard way, via a real
  // webcam screenshot showing this choker's design upside down: its top row, the
  // pointed/spiked elements, rendered at the mesh's bottom instead of its top).
  // `createCurvedRibbonGeometry`'s own v=0-at-mesh-top convention
  // (curved-2_5d-geometry.ts, verified by its own test) is only correct when v=0
  // samples the image's OWN top row directly -- i.e. with the flip disabled.
  texture.flipY = false;
  // Unlit (Step 6/Phase D's own established reasoning, generalized): the source
  // PNG is a real PHOTOGRAPH with its own baked-in lighting/shading already
  // correct for the piece -- applying additional PBR scene lighting on top would
  // double-light it and introduce artifacts a flat photo texture was never meant
  // to receive. `DoubleSide` because the ribbon is a single-sided surface with no
  // back geometry; both faces of the same thin mesh must render.
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, alphaTest: 0.02 });

  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);

  const box = new THREE.Box3().setFromObject(group);
  const boundingBoxWidthMm = box.getSize(new THREE.Vector3()).x;

  return { metadata, instance: group, boundingBoxWidthMm };
}

/**
 * The one per-frame entry point -- mirrors `renderSurfaceAttachedFrame`'s exact
 * contract, reusing the SAME transform math
 * (`computeSurfaceAttachedTransformFromDimensions`) and the SAME render/composite
 * step (`renderInstanceWithTransform`), both from `three-live-bridge.ts`,
 * unmodified. Requires a real WebGL2 context; see that module's own equivalent
 * doc comment for why this is not exercised by `vitest run`.
 */
export function renderCurved25dFrame(
  runtime: ThreeLiveRuntime,
  asset: Live25dJewelleryAsset,
  smoothed: LiveTransform,
  assetGeometry: JewelleryAssetGeometry,
  orientation: SurfaceOrientation,
  viewportWidthPx: number,
  viewportHeightPx: number
): HTMLCanvasElement | null {
  updateCameraForViewport(runtime.camera, viewportWidthPx, viewportHeightPx);
  resizeThreeRenderer(runtime.renderer, viewportWidthPx, viewportHeightPx);
  const cameraConfig = buildCameraConfig(viewportWidthPx, viewportHeightPx);
  const transform = computeSurfaceAttachedTransformFromDimensions(
    smoothed,
    asset.metadata.physicalWidthMm,
    asset.metadata.physicalDepthMm,
    asset.boundingBoxWidthMm,
    assetGeometry,
    orientation,
    viewportWidthPx,
    viewportHeightPx,
    cameraConfig
  );
  if (!transform) return null;
  return renderInstanceWithTransform(runtime, asset.instance, transform);
}
