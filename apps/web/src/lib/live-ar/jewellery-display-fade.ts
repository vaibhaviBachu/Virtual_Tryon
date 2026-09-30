/**
 * Necklace top-edge display fade — a real-webcam-referenced request: other jewellery
 * try-on products (a screenshot cited a Camweara-powered site) show the top of a worn
 * necklace fading softly into the skin/collar rather than cutting off with a hard
 * edge. This module reproduces that as a pure, render-time ALPHA adjustment —
 * multiplying the existing alpha channel by a smooth top-to-bottom ramp — never a
 * change to the stored/uploaded artwork itself (the same "never modify the original
 * asset" discipline every prior phase of this project has held to). The source PNG's
 * own bytes, the catalogue's stored asset, and the alpha-bbox/anchor/scale geometry
 * computed from the RAW image (asset-cache.ts) are all untouched; this only affects
 * the canvas actually handed to the renderer/texture.
 *
 * WHY THIS IS SCOPED TO NECKLACE-FAMILY ITEMS ONLY (see useLiveArSession.ts's own
 * call site): the effect models "the top of a long necklace/haaram strand blending
 * into the neck as it's worn" -- earrings have no equivalent "reaching up into the
 * skin" visual, so applying the same fade there would have no physical rationale and
 * was never requested.
 */

/** Fraction of the asset's own visible (alpha-bbox) height, starting from its top
 * edge, over which alpha ramps from fully transparent to fully opaque. Deliberately
 * small -- this is a soft blend at the very top tips of a necklace, not a fade over
 * a large fraction of the piece. UNCALIBRATED against a real camera (the same status
 * as every other visual-only constant in this project, e.g. NECKLACE_LENGTH_OFFSET_MULTIPLIER's
 * own doc comment) -- a reasonable starting point matching the cited reference
 * image, not a measured result. */
export const NECKLACE_TOP_FADE_FRACTION_OF_BBOX_HEIGHT = 0.08;

/**
 * Pure alpha-ramp function, independent of any canvas/DOM API so it is directly
 * unit-testable. `y`, `bboxTopY`, `fadeEndY` are all in the SAME coordinate space
 * (asset-local pixels, y increasing downward -- asset-cache.ts's own convention).
 * Returns 0 at/above `bboxTopY`, ramps linearly to 1 at `fadeEndY`, and stays 1 for
 * every `y` below that -- i.e. only the top sliver of the visible content is ever
 * touched; everything from `fadeEndY` downward (the vast majority of any necklace,
 * including its pendant) is returned unchanged (multiplier 1).
 */
export function computeTopFadeAlphaMultiplier(y: number, bboxTopY: number, fadeEndY: number): number {
  if (fadeEndY <= bboxTopY) return 1; // degenerate/zero-height fade band -- never divide by zero, never fade
  if (y <= bboxTopY) return 0;
  if (y >= fadeEndY) return 1;
  return (y - bboxTopY) / (fadeEndY - bboxTopY);
}

/**
 * Builds a SAME-RESOLUTION canvas (never downscaled, never re-encoded/compressed --
 * Phase H.1's own explicit "do not stretch/resize the PNG" rule) carrying the exact
 * same pixels as `image`, with alpha multiplied by the top-fade ramp above within the
 * asset's own visible (alpha-bbox) region. Uses `destination-in` compositing: the
 * WHOLE canvas is masked (fade band gets the gradient, everything below it gets an
 * explicit fully-opaque fill) so alpha outside the fade band is provably unchanged,
 * never accidentally zeroed by a partial-coverage composite.
 *
 * Called ONCE per asset load (see useLiveArSession.ts's own "never per frame"
 * discipline for asset geometry) -- never inside the render loop.
 */
export function buildTopFadedDisplayImage(
  image: HTMLImageElement,
  alphaBbox: readonly [number, number, number, number],
  fadeFractionOfBboxHeight: number = NECKLACE_TOP_FADE_FRACTION_OF_BBOX_HEIGHT
): HTMLCanvasElement {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas; // no 2D context available -- return a blank canvas rather than throw; caller falls back gracefully
  ctx.drawImage(image, 0, 0);

  const [, bboxTopY, , bboxBottomY] = alphaBbox;
  const bboxHeight = bboxBottomY - bboxTopY;
  if (!(bboxHeight > 0)) return canvas; // degenerate bbox -- nothing meaningful to fade, return the untouched draw

  const fadeEndY = bboxTopY + fadeFractionOfBboxHeight * bboxHeight;

  // IMPORTANT: `destination-in` zeroes out anything OUTSIDE the shape being drawn --
  // that happens independently for EACH fill call, not cumulatively. Two separate
  // fillRect calls (one for the fade band, one for "everything else, preserved")
  // would each wipe out the region the OTHER call was responsible for (confirmed the
  // hard way: a real-browser test showed alpha zeroed out even far below the fade
  // band). The fix is ONE fillRect covering the WHOLE canvas, with a gradient whose
  // color stops naturally extend beyond their defined 0..1 range (canvas gradients
  // clamp to the boundary color past each stop) -- y < bboxTopY and the fade band
  // itself both use the "0 -> 1" ramp; everything below fadeEndY reads the "1" stop's
  // color (fully opaque, i.e. unchanged) automatically, with no second operation.
  ctx.globalCompositeOperation = "destination-in";
  const gradient = ctx.createLinearGradient(0, bboxTopY, 0, fadeEndY);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";

  return canvas;
}
