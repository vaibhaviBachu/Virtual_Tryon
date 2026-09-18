/**
 * Live AR jewellery asset loading + calibration cache.
 *
 * Ports ai/geometry/asset_geometry.py's `compute_asset_geometry` to the browser: the
 * photo pipeline decodes the stored PNG with numpy and scans its alpha channel
 * server-side; here the same scan runs once, client-side, over a hidden <canvas> after
 * the image loads. Kept numerically equivalent (see asset-cache.test.ts) so the anchor
 * and effective bounding box a Live AR session uses for a given asset matches what the
 * photo pipeline already computes for it.
 *
 * Caching (spec §11 "Asset loading and caching"): both the decoded <img> and its computed
 * geometry are cached by asset id so switching jewellery, or re-rendering frames, never
 * re-fetches or re-scans an asset that is already loaded. Nothing here runs per frame.
 */
import type { AssetResponse } from "@/lib/catalogue-types";
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";

export class InvalidAssetError extends Error {}

interface CacheEntry {
  image: HTMLImageElement;
  geometry: JewelleryAssetGeometry;
}

const cache = new Map<string, Promise<CacheEntry>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load jewellery asset image: ${url}`));
    img.src = url;
  });
}

/** Scans the image's alpha channel for its visible (non-transparent) bounding box.
 * Direct port of the numpy scan in ai/geometry/asset_geometry.py's
 * `compute_asset_geometry`: bbox is [left, top, right, bottom) with right/bottom
 * EXCLUSIVE. Throws InvalidAssetError if the image has no visible content at all, same
 * as the Python raises InvalidAssetError -- never falls back to a fabricated bbox. */
export function computeAlphaBoundingBox(image: HTMLImageElement): [number, number, number, number] {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new InvalidAssetError("Could not get a 2D context to inspect the jewellery asset.");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  let top = -1;
  let bottom = -1;
  let left = width;
  let right = -1;

  for (let y = 0; y < height; y++) {
    let rowHasAlpha = false;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const alpha = data[rowStart + x * 4 + 3];
      if (alpha > 0) {
        rowHasAlpha = true;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    if (rowHasAlpha) {
      if (top === -1) top = y;
      bottom = y;
    }
  }

  if (top === -1 || right === -1) {
    throw new InvalidAssetError("Jewellery asset has no visible (non-transparent) content.");
  }
  // Inclusive last-nonzero index -> exclusive bound, matching the Python `+1`.
  return [left, top, right + 1, bottom + 1];
}

function computeGeometry(image: HTMLImageElement, asset: AssetResponse): JewelleryAssetGeometry {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const alphaBbox = computeAlphaBoundingBox(image);

  let anchorPx: { x: number; y: number };
  let anchorSource: JewelleryAssetGeometry["anchorSource"];
  if (asset.anchor_x !== null && asset.anchor_x !== undefined && asset.anchor_y !== null && asset.anchor_y !== undefined) {
    anchorPx = { x: asset.anchor_x * width, y: asset.anchor_y * height };
    anchorSource = "catalogue_metadata";
  } else {
    // Same documented default as ai/geometry/asset_geometry.py: top-center of the
    // visible bbox, overridable per-asset via catalogue anchor metadata.
    anchorPx = { x: (alphaBbox[0] + alphaBbox[2]) / 2, y: alphaBbox[1] };
    anchorSource = "default_bbox_top_center";
  }

  return {
    widthPx: width,
    heightPx: height,
    alphaBbox,
    anchorPx,
    anchorSource,
    mirrorable: asset.mirrorable,
    // Not exposed by the catalogue API (no physical-dimension column exists yet) -- the
    // relative-scale fallback in computeScale() is what actually drives Live AR sizing
    // today. See geometry.ts's computeScale docstring.
    physicalWidthMm: null,
  };
}

/** Loads (or returns the cached) image + computed geometry for a jewellery asset.
 * `previewUrl` is the signed URL from GET /catalog/assets/{id}. Never call this per
 * frame -- call it once when the jewellery selection changes, and hold the result. */
export function loadJewelleryAssetTexture(
  asset: AssetResponse,
  previewUrl: string
): Promise<{ image: HTMLImageElement; geometry: JewelleryAssetGeometry }> {
  const cacheKey = asset.id;
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const promise = loadImage(previewUrl).then((image) => ({ image, geometry: computeGeometry(image, asset) }));
  cache.set(cacheKey, promise);
  // If loading fails, don't poison the cache -- a retry (e.g. after network recovery)
  // should be able to try again rather than being stuck on a rejected promise forever.
  promise.catch(() => cache.delete(cacheKey));
  return promise;
}

export function clearJewelleryAssetCache(): void {
  cache.clear();
}
