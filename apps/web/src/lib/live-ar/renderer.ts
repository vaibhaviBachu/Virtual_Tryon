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
import {
  JEWELLERY_SHADOW_BLUR_FRACTION_OF_WIDTH,
  JEWELLERY_SHADOW_COLOR,
  JEWELLERY_SHADOW_OFFSET_Y_FRACTION_OF_HEIGHT,
} from "@/lib/live-ar/constants";
import type { LiveTransform, PixelPoint } from "@/lib/live-ar/types";
import type { NecklaceDebugSnapshot } from "@/lib/live-ar/debug";

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

  // Soft contact shadow -- see constants.ts's JEWELLERY_SHADOW_* docstring for why this
  // exists (grounds the sprite against the skin instead of it reading as a flat sticker)
  // and why it's shadow-only, never touching the jewellery's own pixels/colors. Canvas
  // 2D's shadow* properties automatically follow the alpha shape of whatever is drawn in
  // this same drawImage call, and are specified in the CURRENT (already-scaled/rotated)
  // transform space -- so sizing them off the image's own natural pixel dimensions here
  // means the rendered shadow scales correctly with however big this piece currently is,
  // with no separate scale-factor math needed.
  const naturalWidth = getNaturalWidth(image);
  const naturalHeight = getNaturalHeight(image);
  if (naturalWidth > 0 && naturalHeight > 0) {
    ctx.shadowColor = JEWELLERY_SHADOW_COLOR;
    ctx.shadowBlur = naturalWidth * JEWELLERY_SHADOW_BLUR_FRACTION_OF_WIDTH;
    ctx.shadowOffsetY = naturalHeight * JEWELLERY_SHADOW_OFFSET_Y_FRACTION_OF_HEIGHT;
  }

  ctx.drawImage(image, -transform.sourceAnchorPx.x, -transform.sourceAnchorPx.y);
  ctx.restore();
}

/** CanvasImageSource covers several element types (HTMLImageElement, SVGImageElement,
 * HTMLVideoElement, HTMLCanvasElement, ImageBitmap, ...) that don't share one common
 * "natural size" property name -- every jewellery asset drawn here is actually an
 * HTMLImageElement (see asset-cache.ts), these just read that safely without an unsound
 * cast for whatever else the broader type permits. */
function getNaturalWidth(image: CanvasImageSource): number {
  if ("naturalWidth" in image) return image.naturalWidth;
  if ("width" in image && typeof image.width === "number") return image.width;
  return 0;
}

function getNaturalHeight(image: CanvasImageSource): number {
  if ("naturalHeight" in image) return image.naturalHeight;
  if ("height" in image && typeof image.height === "number") return image.height;
  return 0;
}

function drawDebugPoint(ctx: CanvasRenderingContext2D, point: PixelPoint, color: string, label: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "black";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = "12px monospace";
  ctx.fillStyle = "white";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 3;
  ctx.strokeText(label, point.x + 8, point.y - 8);
  ctx.fillText(label, point.x + 8, point.y - 8);
  ctx.restore();
}

/** Draws every point in a `NecklaceDebugSnapshot` directly onto the canvas, in the SAME
 * unmirrored pixel space the jewellery sprite itself is drawn in (see debug.ts's file
 * docstring for why that's correct without any extra mirroring math here). This answers
 * "where does the algorithm THINK the neck is" visually, on the actual runtime frame --
 * not a synthetic fixture, not a unit test. Purely a diagnostic aid; never called unless
 * the caller explicitly enables debug mode (see useLiveArSession.ts). */
export function drawNecklaceDebugOverlay(ctx: CanvasRenderingContext2D, snapshot: NecklaceDebugSnapshot): void {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "cyan";
  ctx.lineWidth = 1;
  // Body centerline (vertical line through the shoulder midpoint).
  if (snapshot.shoulderMidpointPx) {
    ctx.beginPath();
    ctx.moveTo(snapshot.shoulderMidpointPx.x, 0);
    ctx.lineTo(snapshot.shoulderMidpointPx.x, snapshot.imageHeightPx);
    ctx.stroke();
  }
  // Final transformed visible bbox.
  const [l, t, r, b] = snapshot.finalVisibleBboxPx;
  ctx.strokeStyle = "yellow";
  ctx.strokeRect(l, t, r - l, b - t);
  ctx.restore();

  if (snapshot.faceCenterPx) drawDebugPoint(ctx, snapshot.faceCenterPx, "orange", "FACE CENTER");
  if (snapshot.leftEarPx) drawDebugPoint(ctx, snapshot.leftEarPx, "orange", "LEFT EAR");
  if (snapshot.rightEarPx) drawDebugPoint(ctx, snapshot.rightEarPx, "orange", "RIGHT EAR");
  if (snapshot.leftShoulderPx) drawDebugPoint(ctx, snapshot.leftShoulderPx, "lime", "LEFT SHOULDER");
  if (snapshot.rightShoulderPx) drawDebugPoint(ctx, snapshot.rightShoulderPx, "lime", "RIGHT SHOULDER");
  if (snapshot.shoulderMidpointPx) drawDebugPoint(ctx, snapshot.shoulderMidpointPx, "lime", "SHOULDER MID");
  if (snapshot.neckCenterPx) drawDebugPoint(ctx, snapshot.neckCenterPx, "magenta", "NECK CENTER");
  if (snapshot.neckAttachmentPx) drawDebugPoint(ctx, snapshot.neckAttachmentPx, "red", "NECK ATTACHMENT");
  drawDebugPoint(ctx, snapshot.finalAttachmentPx, "white", "JEWELLERY ATTACHMENT");
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
