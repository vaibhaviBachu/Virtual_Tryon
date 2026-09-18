/**
 * Live AR Canvas 2D renderer.
 *
 * RENDERING TECHNOLOGY CHOICE (spec §10: "preferred order WebGL, then WebGPU where
 * safely available, then Canvas 2D fallback... do not add WebGPU because it is
 * newer... primary requirement is stable, real-time rendering across common browsers"):
 * v1 uses Canvas 2D, not WebGL/WebGPU. This is a deliberate, documented choice, not a
 * shortcut disguised as the "fallback" tier:
 *
 * - The actual per-frame work is compositing ONE small transparent sprite (translate +
 *   rotate + uniform scale + alpha blend) onto a video-sized canvas. This is precisely
 *   the operation `CanvasRenderingContext2D.drawImage` is hardware-accelerated for in
 *   every evergreen browser; it is not the kind of workload (thousands of draw calls,
 *   custom shaders, particle/lighting effects) where WebGL's overhead pays for itself.
 * - Canvas 2D has no capability gate to feature-detect around (WebGPU is still behind a
 *   flag or unsupported in some browsers/OSes the spec asks this to run on -- Safari's
 *   desktop support is recent, for one) and needs no shader compilation step, which
 *   keeps the "camera must not freeze while switching jewellery" requirement (spec §12)
 *   trivially true.
 * - HONEST LIMITATION: a WebGL path would matter once Phase-2 realism work (depth-aware
 *   occlusion, shader-based lighting/material rendering -- explicitly out of scope for
 *   this milestone, see docs/live-ar-architecture.md "Future realism architecture") is
 *   built. This module's `LiveTransform` output (plain numbers, no canvas-specific
 *   state) is intentionally renderer-agnostic so a WebGL/WebGPU backend can be added
 *   later without touching tracking, geometry, or smoothing.
 *
 * This module performs ONLY geometry -> pixels compositing. It does not decide what to
 * draw or when (that is the live session hook/component that owns the animation-frame
 * loop) and it never re-fetches or re-decodes the jewellery image (see asset-cache.ts).
 */
import type { LiveTransform } from "@/lib/live-ar/types";

export interface RenderableFrame {
  video: CanvasImageSource;
  videoWidthPx: number;
  videoHeightPx: number;
}

/** Draws the current camera frame followed by the jewellery sprite (if any) onto
 * `ctx`'s canvas. `ctx.canvas` must already be sized to `frame.videoWidthPx` x
 * `frame.videoHeightPx` -- this function does not resize the canvas itself so callers
 * can skip that check on frames where the video size hasn't changed. */
export function renderLiveFrame(
  ctx: CanvasRenderingContext2D,
  frame: RenderableFrame,
  jewellery: { image: CanvasImageSource; transform: LiveTransform; opacity: number } | null
): void {
  ctx.clearRect(0, 0, frame.videoWidthPx, frame.videoHeightPx);
  ctx.drawImage(frame.video, 0, 0, frame.videoWidthPx, frame.videoHeightPx);
  if (jewellery !== null) {
    drawJewelleryOverlay(ctx, jewellery.image, jewellery.transform, jewellery.opacity);
  }
}

/** Composites just the jewellery sprite using the same anchor-coincidence composition
 * as ai/geometry/transform.py's `compute_transform` (translate the asset's own anchor
 * to the target anchor, then scale, then rotate -- see buildLiveTransform's docstring
 * in geometry.ts for why a mirrored asset can be drawn directly from its ORIGINAL
 * (unmirrored) anchor rather than needing a separately-mirrored geometry object). */
export function drawJewelleryOverlay(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  transform: LiveTransform,
  opacity: number
): void {
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  if (clampedOpacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = clampedOpacity;
  ctx.translate(transform.anchorPx.x, transform.anchorPx.y);
  ctx.rotate((transform.rotationDegrees * Math.PI) / 180);
  ctx.scale(transform.mirrored ? -transform.scaleFactor : transform.scaleFactor, transform.scaleFactor);
  ctx.drawImage(image, -transform.sourceAnchorPx.x, -transform.sourceAnchorPx.y);
  ctx.restore();
}

/** Resizes a canvas to match the video's intrinsic pixel dimensions. Call this only
 * when the size actually changed (e.g. camera resolution negotiated after startup) --
 * resizing a canvas clears it and is not free, so it must not run every frame. */
export function ensureCanvasSize(canvas: HTMLCanvasElement, widthPx: number, heightPx: number): boolean {
  if (canvas.width === widthPx && canvas.height === heightPx) return false;
  canvas.width = widthPx;
  canvas.height = heightPx;
  return true;
}
