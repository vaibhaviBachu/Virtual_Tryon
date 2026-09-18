import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidAssetError, computeAlphaBoundingBox } from "@/lib/live-ar/asset-cache";

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
