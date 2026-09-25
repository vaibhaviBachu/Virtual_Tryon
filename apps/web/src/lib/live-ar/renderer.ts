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
import type { LiveTransform, PixelPoint } from "@/lib/live-ar/types";
import type { NecklaceDebugSnapshot } from "@/lib/live-ar/debug";
import type { JewelleryStrip } from "@/lib/live-ar/jewellery-deformation";

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
  jewellery: {
    image: CanvasImageSource;
    transform: LiveTransform;
    opacity: number;
    strips?: JewelleryStrip[] | null;
    horizontalForeshorten?: number;
  } | null
): void {
  ctx.clearRect(0, 0, frame.videoWidthPx, frame.videoHeightPx);
  ctx.drawImage(frame.video, 0, 0, frame.videoWidthPx, frame.videoHeightPx);
  if (jewellery !== null) {
    drawJewelleryOverlay(ctx, jewellery.image, jewellery.transform, jewellery.opacity, jewellery.strips, jewellery.horizontalForeshorten);
  }
}

/** Composites just the jewellery sprite using the same anchor-coincidence composition
 * as ai/geometry/transform.py's `compute_transform` (translate the asset's own anchor
 * to the target anchor, then scale, then rotate -- see buildLiveTransform's docstring
 * in geometry.ts for why a mirrored asset can be drawn directly from its ORIGINAL
 * (unmirrored) anchor rather than needing a separately-mirrored geometry object).
 *
 * `strips` (M6.5, jewellery-deformation.ts): when omitted/null/empty, draws the WHOLE
 * image in one `drawImage` call -- byte-for-byte the pre-M6.5 behavior. When provided,
 * draws each strip with its own `dropPx` added to the local Y offset, approximating the
 * jewellery bowing to follow the neck (see jewellery-deformation.ts's file docstring).
 * This is the ONE function every draw path (the visible sprite, the occluded-compositor
 * sprite via drawOccludedJewelleryOverlay below, and useLiveArSession.ts's own
 * alpha-footprint local-canvas render) goes through, so curvature can never silently
 * drift between what's drawn, what's occluded, and what's alpha-footprint-measured --
 * the same "one source of truth for the transform" discipline M6.4's bounding-box bug
 * fix established, extended to cover curvature too.
 *
 * `horizontalForeshorten` (M6.6, neck-projection.ts's computeHorizontalForeshorten):
 * an extra multiplicative factor on ONLY the local X scale, modeling "viewed at an
 * angle, so narrower than dead-on." Defaults to 1 (no-op, byte-for-byte pre-M6.6
 * width) -- every M6.5 call site/test that doesn't pass it is unaffected. */
export function drawJewelleryOverlay(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  transform: LiveTransform,
  opacity: number,
  strips?: JewelleryStrip[] | null,
  horizontalForeshorten: number = 1
): void {
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  if (clampedOpacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = clampedOpacity;
  ctx.translate(transform.anchorPx.x, transform.anchorPx.y);
  ctx.rotate((transform.rotationDegrees * Math.PI) / 180);
  const scaleX = (transform.mirrored ? -transform.scaleFactor : transform.scaleFactor) * horizontalForeshorten;
  ctx.scale(scaleX, transform.scaleFactor);
  if (strips && strips.length > 0) {
    for (const strip of strips) {
      ctx.drawImage(
        image,
        strip.sourceX,
        0,
        strip.sourceWidth,
        strip.sourceHeight,
        strip.sourceX - transform.sourceAnchorPx.x,
        strip.dropPx - transform.sourceAnchorPx.y,
        strip.sourceWidth,
        strip.sourceHeight
      );
    }
  } else {
    ctx.drawImage(image, -transform.sourceAnchorPx.x, -transform.sourceAnchorPx.y);
  }
  ctx.restore();
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
 * the caller explicitly enables debug mode (see useLiveArSession.ts).
 *
 * M6.6 ("Wear Geometry Debug" -- spec Step 11) extends this SAME overlay (rather than
 * adding a second, separate debug panel) with the neck-surface/contact-curve markers:
 * left/right neck boundary points (neck-surface.ts's ellipse model) and the jewellery's
 * actual per-strip contact curve (debug.ts's `contactCurvePx`, built from the SAME
 * strip plan that was actually rendered this frame -- never a separate approximation). */
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

  // M6.6: neck surface boundary line (left neck boundary -> right neck boundary),
  // drawn as its own distinct dashed line so it reads as "the ellipse's front-facing
  // width" rather than being confused with the shoulder centerline above.
  if (snapshot.leftNeckBoundaryPx && snapshot.rightNeckBoundaryPx) {
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = "deepskyblue";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(snapshot.leftNeckBoundaryPx.x, snapshot.leftNeckBoundaryPx.y);
    ctx.lineTo(snapshot.rightNeckBoundaryPx.x, snapshot.rightNeckBoundaryPx.y);
    ctx.stroke();
    ctx.restore();
    drawDebugPoint(ctx, snapshot.leftNeckBoundaryPx, "deepskyblue", "LEFT NECK");
    drawDebugPoint(ctx, snapshot.rightNeckBoundaryPx, "deepskyblue", "RIGHT NECK");
  }

  // M6.6: the jewellery's actual contact curve -- a connected polyline through every
  // strip's real (post-yaw) contact point, the SAME points actually rendered this frame.
  if (snapshot.contactCurvePx.length > 1) {
    ctx.save();
    ctx.strokeStyle = "chartreuse";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(snapshot.contactCurvePx[0].x, snapshot.contactCurvePx[0].y);
    for (const point of snapshot.contactCurvePx.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
  }

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

/**
 * Phase G (docs/true-3d-neck-attachment.md §10): draws the real parametric neck
 * surface (three/neck-surface-3d.ts), already projected to screen space by the
 * caller (`useLiveArSession.ts`, via `projectPointToScreen` against the SAME
 * `THREE.PerspectiveCamera` the jewellery itself was rendered with -- one source of
 * truth, never a second/approximate projection). Answers Step 15's own diagnostic
 * ask directly: "why does the jewellery float" is only answerable by SEEING where
 * the code currently thinks the neck surface, its normal, and the jewellery's own
 * attachment point are, on the actual live frame -- not by reading numbers alone.
 * Purely diagnostic; never affects jewellery placement/compositing itself.
 */
export function drawNeckSurfaceDebugOverlay(
  ctx: CanvasRenderingContext2D,
  outlinePx: PixelPoint[],
  frontPointPx: PixelPoint,
  normalEndPx: PixelPoint,
  attachmentPx: PixelPoint
): void {
  if (outlinePx.length > 1) {
    ctx.save();
    ctx.strokeStyle = "deepskyblue";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(outlinePx[0].x, outlinePx[0].y);
    for (const point of outlinePx.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "yellow";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(frontPointPx.x, frontPointPx.y);
  ctx.lineTo(normalEndPx.x, normalEndPx.y);
  ctx.stroke();
  ctx.restore();

  drawDebugPoint(ctx, frontPointPx, "deepskyblue", "NECK SURFACE FRONT");
  drawDebugPoint(ctx, attachmentPx, "yellow", "3D JEWELLERY ORIGIN");
}

/** M6.4 (docs/live-ar-realism-architecture.md §6/§8/§17): draws one jewellery overlay
 * onto an OFFSCREEN canvas -- never the main canvas directly -- then erases the
 * occluding pixels (hair/qualifying-clothes, per occlusion.ts's documented rule) using
 * `globalCompositeOperation: "destination-out"`, ISOLATED to that offscreen buffer.
 *
 * WHY ISOLATED, NOT APPLIED DIRECTLY TO THE MAIN CANVAS: this is the structural fix for
 * the exact failure class that broke three earlier contact-shadow attempts (see
 * README.md's "Known issues" and docs/live-ar-realism-architecture.md §9) --
 * specifically, `globalCompositeOperation: "source-atop"` masking against the ENTIRE
 * existing main-canvas content (the video frame, already drawn) rather than just the
 * one sprite it was meant to affect, because it was applied on a shared canvas that
 * already had other content in the same save/restore scope. Here, `destination-out`
 * can only ever erase from THIS jewellery sprite -- nothing else is ever drawn onto
 * `offscreenCtx` -- so that specific failure mode cannot recur by construction, not by
 * being more careful this time.
 *
 * `offscreenCtx`'s canvas must already be sized to `outputWidthPx`/`outputHeightPx`
 * (matching `ensureCanvasSize`'s existing "caller resizes, this function doesn't"
 * convention) and is caller-owned/reused across frames -- this function never creates
 * a canvas itself (Step 5's "avoid unnecessary allocations every frame"). Caller is
 * responsible for then drawing this offscreen canvas onto the main canvas with plain
 * `source-over` (e.g. `mainCtx.drawImage(offscreenCanvas, 0, 0)`). */
export function drawOccludedJewelleryOverlay(
  offscreenCtx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  transform: LiveTransform,
  opacity: number,
  eraseMaskSource: CanvasImageSource,
  eraseMaskWidthPx: number,
  eraseMaskHeightPx: number,
  outputWidthPx: number,
  outputHeightPx: number,
  strips?: JewelleryStrip[] | null,
  horizontalForeshorten: number = 1
): void {
  offscreenCtx.clearRect(0, 0, outputWidthPx, outputHeightPx);
  drawJewelleryOverlay(offscreenCtx, image, transform, opacity, strips, horizontalForeshorten);
  offscreenCtx.save();
  offscreenCtx.globalCompositeOperation = "destination-out";
  offscreenCtx.drawImage(eraseMaskSource, 0, 0, eraseMaskWidthPx, eraseMaskHeightPx, 0, 0, outputWidthPx, outputHeightPx);
  offscreenCtx.restore();
}

/** M6.8 (spec Step 15): the 3D-rendering equivalent of `drawOccludedJewelleryOverlay`
 * above, for a jewellery item rendered by the Three.js pipeline instead of the 2D
 * sprite renderer. `threeCanvasSource` is the ALREADY-RENDERED Three.js output --
 * the 3D camera's own projection already placed/scaled/rotated the mesh correctly
 * (three/three-transform.ts), so unlike the 2D path, NO additional translate/rotate/
 * scale is applied here; this function only handles opacity + the SAME
 * destination-out erase step `drawOccludedJewelleryOverlay` uses, reusing the
 * EXISTING occlusion mask machinery verbatim (spec Step 15: "do not rewrite the
 * entire occlusion architecture" -- this reuses 100% of it, only the source of the
 * jewellery pixels differs). `threeCanvasSource` must already be sized to
 * `outputWidthPx`/`outputHeightPx` (the full video frame -- the 3D camera's viewport
 * IS the video viewport, see three-camera.ts). */
export function compositeOccluded3dOverlay(
  offscreenCtx: CanvasRenderingContext2D,
  threeCanvasSource: CanvasImageSource,
  opacity: number,
  eraseMaskSource: CanvasImageSource,
  eraseMaskWidthPx: number,
  eraseMaskHeightPx: number,
  outputWidthPx: number,
  outputHeightPx: number
): void {
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  offscreenCtx.clearRect(0, 0, outputWidthPx, outputHeightPx);
  if (clampedOpacity > 0) {
    offscreenCtx.save();
    offscreenCtx.globalAlpha = clampedOpacity;
    offscreenCtx.drawImage(threeCanvasSource, 0, 0, outputWidthPx, outputHeightPx);
    offscreenCtx.restore();
  }
  offscreenCtx.save();
  offscreenCtx.globalCompositeOperation = "destination-out";
  offscreenCtx.drawImage(eraseMaskSource, 0, 0, eraseMaskWidthPx, eraseMaskHeightPx, 0, 0, outputWidthPx, outputHeightPx);
  offscreenCtx.restore();
}

/** Draws a pre-built segmentation-mask canvas (see useLiveArSession.ts -- it owns and
 * reuses ONE scratch canvas across frames, per Step 5's "avoid unnecessary canvas
 * allocations every frame"; this function never creates one itself) onto the main
 * canvas, scaled up from the mask's own native resolution (e.g. 256x256) to the video's
 * actual pixel size, in the SAME unmirrored canvas space the video/jewellery are
 * already drawn in. M6.3 debug-only (docs/live-ar-realism-architecture.md §6/§8/§17) --
 * never called unless the caller explicitly enables the segmentation debug toggle, and
 * has no effect on jewellery placement/compositing. Because this draws into the same
 * coordinate space as everything else (no independent mirror, no separate transform),
 * the wrapping <div>'s single CSS mirror transform (coordinates.ts) already applies to
 * it correctly, exactly like the necklace debug overlay above. */
export function drawSegmentationDebugOverlay(
  ctx: CanvasRenderingContext2D,
  maskSource: CanvasImageSource,
  maskWidthPx: number,
  maskHeightPx: number,
  videoWidthPx: number,
  videoHeightPx: number
): void {
  ctx.drawImage(maskSource, 0, 0, maskWidthPx, maskHeightPx, 0, 0, videoWidthPx, videoHeightPx);
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
