import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidAssetError, computeAlphaBoundingBox, computeGeometry } from "@/lib/live-ar/asset-cache";
import type { AssetResponse } from "@/lib/catalogue-types";

/**
 * jsdom does not implement real 2D canvas pixel rendering (no `canvas` npm package in
 * this project), so these tests stub `HTMLCanvasElement.prototype.getContext` with a
 * fake context whose `getImageData` returns a synthetic RGBA buffer built directly from
 * a described alpha map. This exercises the exact same pixel-scan logic
 * `computeAlphaBoundingBox` runs against a real decoded PNG, just with hand-built pixel
 * data instead of an actual image file.
 */
function stubCanvasWithAlphaMap(alphaMap: number[][]): void {
  const height = alphaMap.length;
  const width = alphaMap[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx + 3] = alphaMap[y][x];
    }
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data, width, height }),
  } as unknown as CanvasRenderingContext2D);
}

function fakeImage(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

describe("computeAlphaBoundingBox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds the tight bounding box of non-transparent pixels, right/bottom exclusive", () => {
    // 5x5 image; visible (alpha>0) pixels form rows 1-2, cols 1-3.
    const alphaMap = [
      [0, 0, 0, 0, 0],
      [0, 255, 255, 255, 0],
      [0, 255, 0, 255, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    stubCanvasWithAlphaMap(alphaMap);
    const bbox = computeAlphaBoundingBox(fakeImage(5, 5));
    expect(bbox).toEqual([1, 1, 4, 3]);
  });

  it("throws InvalidAssetError when the image is fully transparent", () => {
    const alphaMap = [
      [0, 0],
      [0, 0],
    ];
    stubCanvasWithAlphaMap(alphaMap);
    expect(() => computeAlphaBoundingBox(fakeImage(2, 2))).toThrow(InvalidAssetError);
  });

  it("treats the full canvas as visible content when every pixel has alpha", () => {
    const alphaMap = [
      [10, 10],
      [10, 10],
    ];
    stubCanvasWithAlphaMap(alphaMap);
    const bbox = computeAlphaBoundingBox(fakeImage(2, 2));
    expect(bbox).toEqual([0, 0, 2, 2]);
  });

  it("throws InvalidAssetError when a 2D context is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => computeAlphaBoundingBox(fakeImage(2, 2))).toThrow(InvalidAssetError);
  });
});

function fakeAsset(overrides: Partial<AssetResponse> = {}): AssetResponse {
  return {
    id: "asset-1",
    jewellery_id: "jewellery-1",
    asset_type: "processed",
    mime_type: "image/png",
    width_px: 100,
    height_px: 100,
    file_size_bytes: 1234,
    processing_status: "ready",
    processing_error: null,
    anchor_x: null,
    anchor_y: null,
    attachment_point: null,
    mirrorable: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// M6.5 spec Step 6: "physical dimensions already exist in the catalogue -- use them."
// physical_width_mm lives on the PARENT JewelleryResponse, not AssetResponse, so
// computeGeometry takes it as an explicit third argument rather than reading it off
// `asset` -- these tests cover that threading directly (see computeGeometry's own doc
// comment for why the value can't come from `asset` itself).
describe("computeGeometry — physicalWidthMm threading (M6.5 Step 6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carries the passed-in physicalWidthMm through to the resulting geometry", () => {
    stubCanvasWithAlphaMap([
      [255, 255],
      [255, 255],
    ]);
    const geometry = computeGeometry(fakeImage(2, 2), fakeAsset(), 42.5);
    expect(geometry.physicalWidthMm).toBe(42.5);
  });

  it("defaults to null when no physicalWidthMm is known (byte-for-byte the pre-M6.5 behavior)", () => {
    stubCanvasWithAlphaMap([
      [255, 255],
      [255, 255],
    ]);
    const geometry = computeGeometry(fakeImage(2, 2), fakeAsset(), null);
    expect(geometry.physicalWidthMm).toBeNull();
  });

  it("uses the catalogue anchor when the asset has one, else the alpha-bbox top-center default", () => {
    stubCanvasWithAlphaMap([
      [0, 0, 0, 0],
      [0, 255, 255, 0],
      [0, 255, 255, 0],
      [0, 0, 0, 0],
    ]);
    const withAnchor = computeGeometry(fakeImage(4, 4), fakeAsset({ anchor_x: 0.25, anchor_y: 0.75 }), null);
    expect(withAnchor.anchorPx).toEqual({ x: 1, y: 3 });
    expect(withAnchor.anchorSource).toBe("catalogue_metadata");

    const withoutAnchor = computeGeometry(fakeImage(4, 4), fakeAsset(), null);
    expect(withoutAnchor.anchorPx).toEqual({ x: 2, y: 1 }); // bbox is [1,1,3,3) -> top-center (2,1)
    expect(withoutAnchor.anchorSource).toBe("default_bbox_top_center");
  });

  it("carries mirrorable through from the asset", () => {
    stubCanvasWithAlphaMap([
      [255, 255],
      [255, 255],
    ]);
    expect(computeGeometry(fakeImage(2, 2), fakeAsset({ mirrorable: true }), null).mirrorable).toBe(true);
    expect(computeGeometry(fakeImage(2, 2), fakeAsset({ mirrorable: false }), null).mirrorable).toBe(false);
  });
});
