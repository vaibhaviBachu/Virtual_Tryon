import { describe, expect, it } from "vitest";

import { resolveJewelleryRepresentation } from "@/lib/live-ar/jewellery-representation";
import type { Gltf3dAssetMetadata } from "@/lib/live-ar/jewellery-representation";
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";

function fakeGeometry(): JewelleryAssetGeometry {
  return {
    widthPx: 100,
    heightPx: 100,
    alphaBbox: [0, 0, 100, 100],
    anchorPx: { x: 50, y: 0 },
    anchorSource: "default_bbox_top_center",
    mirrorable: false,
    physicalWidthMm: null,
  };
}

function fakeFlatAsset() {
  return { image: {} as HTMLImageElement, geometry: fakeGeometry() };
}

function fakeGltf3dAsset(overrides: Partial<Gltf3dAssetMetadata> = {}): Gltf3dAssetMetadata {
  return {
    modelUrl: "https://example.test/necklace.glb",
    modelFormat: "glb",
    physicalWidthMm: 180,
    physicalHeightMm: 40,
    physicalDepthMm: 15,
    attachmentType: "neck_choker",
    anchor: null,
    mirrorable: false,
    materialProfile: "pbr-metallic-roughness",
    scaleCorrection: null,
    rotationCorrectionDegrees: null,
    productionVerified: true,
    ...overrides,
  };
}

describe("resolveJewelleryRepresentation", () => {
  it("falls back to flat-2d when nothing else is available (today's ONLY real catalogue state)", () => {
    const result = resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset() });
    expect(result.type).toBe("flat-2d");
    expect(result.gltf3dAsset).toBeNull();
    expect(result.layeredAssetUrls).toBeNull();
    expect(result.flatAsset).not.toBeNull();
  });

  it("falls back to flat-2d when gltf3dAsset/layeredAssetUrls are explicitly null or undefined", () => {
    expect(resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), gltf3dAsset: null, layeredAssetUrls: null }).type).toBe("flat-2d");
    expect(resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset() }).type).toBe("flat-2d");
  });

  it("falls back to flat-2d when layeredAssetUrls is an empty array (present but nothing usable in it)", () => {
    expect(resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), layeredAssetUrls: [] }).type).toBe("flat-2d");
  });

  it("selects gltf-3d when a real glTF asset metadata object is present", () => {
    const gltf3dAsset = fakeGltf3dAsset();
    const result = resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), gltf3dAsset });
    expect(result.type).toBe("gltf-3d");
    expect(result.gltf3dAsset).toBe(gltf3dAsset);
  });

  it("selects layered-2.5d when layered view URLs are present and no glTF asset is", () => {
    const urls = ["front.png", "left.png", "right.png"];
    const result = resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), layeredAssetUrls: urls });
    expect(result.type).toBe("layered-2.5d");
    expect(result.layeredAssetUrls).toEqual(urls);
  });

  it("prefers gltf-3d over layered-2.5d when both happen to be present (richer representation wins)", () => {
    const result = resolveJewelleryRepresentation({
      flatAsset: fakeFlatAsset(),
      gltf3dAsset: fakeGltf3dAsset(),
      layeredAssetUrls: ["front.png", "left.png"],
    });
    expect(result.type).toBe("gltf-3d");
  });

  it("carries the flat 2D asset through UNCHANGED regardless of which representation is selected -- the existing PNG renderer must always have a fallback available (spec Step 18)", () => {
    const flatAsset = fakeFlatAsset();
    const withGltf = resolveJewelleryRepresentation({ flatAsset, gltf3dAsset: fakeGltf3dAsset() });
    const withLayered = resolveJewelleryRepresentation({ flatAsset, layeredAssetUrls: ["a.png"] });
    const flatOnly = resolveJewelleryRepresentation({ flatAsset });
    expect(withGltf.flatAsset).toBe(flatAsset);
    expect(withLayered.flatAsset).toBe(flatAsset);
    expect(flatOnly.flatAsset).toBe(flatAsset);
  });

  it("tolerates a null flatAsset without throwing (a load-in-progress/failed item), still resolving a representation type", () => {
    expect(() => resolveJewelleryRepresentation({ flatAsset: null })).not.toThrow();
    expect(resolveJewelleryRepresentation({ flatAsset: null }).type).toBe("flat-2d");
    expect(resolveJewelleryRepresentation({ flatAsset: null, gltf3dAsset: fakeGltf3dAsset() }).type).toBe("gltf-3d");
  });

  it("treats an UNVERIFIED gltf3dAsset exactly like no gltf3dAsset at all -- a procedural prototype existing is never enough on its own (docs/diamond-choker-asset-restoration.md)", () => {
    const result = resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), gltf3dAsset: fakeGltf3dAsset({ productionVerified: false }) });
    expect(result.type).toBe("flat-2d");
    expect(result.gltf3dAsset).toBeNull();
  });

  it("an unverified gltf3dAsset still falls back correctly to layered-2.5d when that's also present", () => {
    const result = resolveJewelleryRepresentation({
      flatAsset: fakeFlatAsset(),
      gltf3dAsset: fakeGltf3dAsset({ productionVerified: false }),
      layeredAssetUrls: ["front.png"],
    });
    expect(result.type).toBe("layered-2.5d");
  });

  it("reuses the catalogue's own physical dimensions on the gltf3dAsset metadata -- never a duplicated/independent dimension", () => {
    const gltf3dAsset = fakeGltf3dAsset({ physicalWidthMm: 175, physicalHeightMm: 38, physicalDepthMm: 12 });
    const result = resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), gltf3dAsset });
    expect(result.gltf3dAsset).toEqual(gltf3dAsset);
    expect(result.gltf3dAsset!.physicalWidthMm).toBe(175);
    expect(result.gltf3dAsset!.physicalHeightMm).toBe(38);
    expect(result.gltf3dAsset!.physicalDepthMm).toBe(12);
  });
});
