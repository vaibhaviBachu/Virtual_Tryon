import { describe, expect, it } from "vitest";

import { resolveJewelleryRepresentation } from "@/lib/live-ar/jewellery-representation";
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

describe("resolveJewelleryRepresentation", () => {
  it("falls back to flat-2d when nothing else is available (today's ONLY real catalogue state)", () => {
    const result = resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset() });
    expect(result.type).toBe("flat-2d");
    expect(result.gltfAssetUrl).toBeNull();
    expect(result.layeredAssetUrls).toBeNull();
    expect(result.flatAsset).not.toBeNull();
  });

  it("falls back to flat-2d when gltfAssetUrl/layeredAssetUrls are explicitly null or undefined", () => {
    expect(resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), gltfAssetUrl: null, layeredAssetUrls: null }).type).toBe("flat-2d");
    expect(resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset() }).type).toBe("flat-2d");
  });

  it("falls back to flat-2d when layeredAssetUrls is an empty array (present but nothing usable in it)", () => {
    expect(resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), layeredAssetUrls: [] }).type).toBe("flat-2d");
  });

  it("selects gltf-3d when a real glTF asset URL is present", () => {
    const result = resolveJewelleryRepresentation({ flatAsset: fakeFlatAsset(), gltfAssetUrl: "https://example.test/necklace.glb" });
    expect(result.type).toBe("gltf-3d");
    expect(result.gltfAssetUrl).toBe("https://example.test/necklace.glb");
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
      gltfAssetUrl: "necklace.glb",
      layeredAssetUrls: ["front.png", "left.png"],
    });
    expect(result.type).toBe("gltf-3d");
  });

  it("carries the flat 2D asset through UNCHANGED regardless of which representation is selected -- the existing PNG renderer must always have a fallback available (spec Step 10)", () => {
    const flatAsset = fakeFlatAsset();
    const withGltf = resolveJewelleryRepresentation({ flatAsset, gltfAssetUrl: "necklace.glb" });
    const withLayered = resolveJewelleryRepresentation({ flatAsset, layeredAssetUrls: ["a.png"] });
    const flatOnly = resolveJewelleryRepresentation({ flatAsset });
    expect(withGltf.flatAsset).toBe(flatAsset);
    expect(withLayered.flatAsset).toBe(flatAsset);
    expect(flatOnly.flatAsset).toBe(flatAsset);
  });

  it("tolerates a null flatAsset without throwing (a load-in-progress/failed item), still resolving a representation type", () => {
    expect(() => resolveJewelleryRepresentation({ flatAsset: null })).not.toThrow();
    expect(resolveJewelleryRepresentation({ flatAsset: null }).type).toBe("flat-2d");
    expect(resolveJewelleryRepresentation({ flatAsset: null, gltfAssetUrl: "necklace.glb" }).type).toBe("gltf-3d");
  });
});
