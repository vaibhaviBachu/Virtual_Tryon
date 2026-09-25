"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AssetWithPreviewResponse } from "@/lib/catalogue-types";
import { loadJewelleryAssetTexture } from "@/lib/live-ar/asset-cache";
import { startLiveCamera, stopLiveCamera, type CameraError } from "@/lib/live-ar/camera";
import { containerMirrorTransform } from "@/lib/live-ar/coordinates";
import { computeNecklaceDebugSnapshot, type NecklaceDebugSnapshot } from "@/lib/live-ar/debug";
import { computeTransformedBoundingBox, estimateHeadYawAsymmetry, planCategoryRenders } from "@/lib/live-ar/geometry";
import { computeJewelleryStrips, type JewelleryStrip } from "@/lib/live-ar/jewellery-deformation";
import { resolveNecklaceAttachmentModel, type JewelleryAttachmentModel } from "@/lib/live-ar/jewellery-attachment";
import {
  NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH,
  OCCLUSION_STALE_MASK_THRESHOLD_MS,
  SEGMENTATION_INTERVAL_MS_DEFAULT,
} from "@/lib/live-ar/constants";
import { computeNeckReferenceFrame } from "@/lib/live-ar/neck-reference";
import {
  applyJewelleryAlphaToOcclusionMask,
  applyRenderedAlphaToOcclusionMask,
  buildFinalVisibilityMaskRgba,
  buildJewelleryAlphaDebugRgba,
  buildOcclusionDebugRgba,
  buildOcclusionEraseRgba,
  clipRegionToMask,
  computeAlphaDownscaleSourceRect,
  computeCategoryDistribution,
  computeHairOverlapReport,
  computeJewelleryAlphaOcclusionReport,
  computeNecklaceOcclusionMask,
  isMaskStale,
  toMaskSpaceRegion,
  type CategoryDistribution,
  type HairOverlapReport,
  type JewelleryAlphaOcclusionReport,
} from "@/lib/live-ar/occlusion";
import { PerformanceTracker, type PerformanceSnapshot } from "@/lib/live-ar/performance";
import { evaluateEarringsReadiness, evaluateNecklaceReadiness, type ReadinessResult } from "@/lib/live-ar/readiness";
import {
  compositeOccluded3dOverlay,
  drawJewelleryOverlay,
  drawNecklaceDebugOverlay,
  drawNeckSurfaceDebugOverlay,
  drawOccludedJewelleryOverlay,
  drawSegmentationDebugOverlay,
  ensureCanvasSize,
  renderLiveFrame,
} from "@/lib/live-ar/renderer";
import { buildSegmentationDebugRgba, createLiveSegmenter, runSegmentation, SegmentationCadenceScheduler, type LiveSegmenter } from "@/lib/live-ar/segmentation";
import { TransformSmoother } from "@/lib/live-ar/smoothing";
import { resolveAttachmentOrientation } from "@/lib/live-ar/three/body-attachment";
import {
  buildCurved25dAsset,
  renderCurved25dFrame,
  resolveCurved25dAssetMetadata,
  type Live25dJewelleryAsset,
} from "@/lib/live-ar/three/curved-2_5d-bridge";
import { computeNeckSurfaceFrame, derivePxPerMm, neckSurfacePointAt, type NeckSurfaceFrame } from "@/lib/live-ar/three/neck-surface-3d";
import {
  attachmentTypeToTrackedCategory,
  createThreeLiveRuntime,
  deriveScaleResultFromSmoothedTransform,
  disposeThreeLiveRuntime,
  loadLive3dJewelleryAsset,
  renderSurfaceAttachedFrame,
  type Live3dJewelleryAsset,
  type ThreeLiveRuntime,
} from "@/lib/live-ar/three/three-live-bridge";
import { getThreeRenderStats } from "@/lib/live-ar/three/three-renderer";
import { projectPointToScreen } from "@/lib/live-ar/three/three-transform";
import { createLiveTrackers, detectFrameWithTiming, type LiveTrackers } from "@/lib/live-ar/tracking";
import { TrackingStateMachine } from "@/lib/live-ar/tracking-state";
import type { CategorySlug, JewelleryAssetGeometry, LiveTransform, TrackingStatus } from "@/lib/live-ar/types";

// How often the debug NUMERIC readout (not the canvas overlay, which is drawn every
// frame) is copied into React state, to avoid a setState-triggered re-render 30-60
// times a second. Purely a UI-update-rate choice -- has no effect on the geometry.
const DEBUG_SNAPSHOT_STATE_THROTTLE_MS = 300;

export type CameraStatus = "idle" | "starting" | "ready" | "error";
export type TrackersStatus = "idle" | "loading" | "ready" | "error";

interface SlotState {
  trackingMachine: TrackingStateMachine<LiveTransform>;
  smoother: TransformSmoother;
}

function makeSlotState(): SlotState {
  return { trackingMachine: new TrackingStateMachine<LiveTransform>(), smoother: new TransformSmoother() };
}

/** M6.5/M6.6: `attachmentModel` is resolved once at asset-load time and reused every
 * frame (category slug + the asset's own geometry never change frame to frame -- see
 * jewellery-attachment.ts's own docstring). `strips`/`horizontalForeshorten` are
 * deliberately NOT cached here as of M6.6: they now depend on the current frame's
 * estimated head yaw (geometry.ts's estimateHeadYawAsymmetry), which changes
 * continuously, so they are recomputed every frame in the render loop instead (see
 * jewellery-deformation.ts's file docstring on why this is still cheap). Null for
 * earrings (attachment class / neck curvature are necklace-only concepts). */
interface LoadedJewelleryTexture {
  image: HTMLImageElement;
  geometry: JewelleryAssetGeometry;
  attachmentModel: JewelleryAttachmentModel | null;
}

function resolveLoadedTexture(
  loaded: { image: HTMLImageElement; geometry: JewelleryAssetGeometry },
  category: CategorySlug,
  categorySlug: string | null
): LoadedJewelleryTexture {
  if (category !== "necklace") {
    return { ...loaded, attachmentModel: null };
  }
  return { ...loaded, attachmentModel: resolveNecklaceAttachmentModel(categorySlug, loaded.geometry) };
}

/** Smooths only the numeric fields of a LiveTransform, preserving `mirrored` and
 * `sourceAnchorPx` unchanged -- those are asset-space constants for the current
 * texture, not tracked quantities, so smoothing them would be meaningless. */
function smoothTransform(smoother: TransformSmoother, transform: LiveTransform, dtMs: number): LiveTransform {
  const smoothed = smoother.update(
    { anchorXPx: transform.anchorPx.x, anchorYPx: transform.anchorPx.y, scale: transform.scaleFactor, rotationDegrees: transform.rotationDegrees },
    dtMs
  );
  return {
    anchorPx: { x: smoothed.anchorXPx, y: smoothed.anchorYPx },
    scaleFactor: smoothed.scale,
    rotationDegrees: smoothed.rotationDegrees,
    sourceAnchorPx: transform.sourceAnchorPx,
    mirrored: transform.mirrored,
  };
}

/**
 * Phase G Step 13/14, extracted for Phase 2.5D reuse (docs/2-5d-jewellery-surface-
 * attachment.md): composites an already-rendered, transparent-background 3D/2.5D
 * canvas onto the EXISTING segmentation-aware occlusion machinery. Generic over
 * WHICH representation produced `renderedCanvas` -- the procedural GLB (Phase E-G)
 * or the curved-2.5D textured mesh (this phase): both are plain `HTMLCanvasElement`s
 * with real alpha, and refining the coarse category mask with that alpha / building
 * the erase pattern / compositing has never depended on how those pixels were
 * produced. Callers reuse the SAME scratch-canvas refs for both representations --
 * safe because at most one is ever active for a given item at a time (the render
 * loop's own gltf-3d > curved-2.5d priority), never a second allocation.
 */
function compositeRendered3dFrame(
  renderedCanvas: HTMLCanvasElement,
  transform: LiveTransform,
  opacity: number,
  geometry: JewelleryAssetGeometry,
  videoWidthPx: number,
  videoHeightPx: number,
  frameStartMs: number,
  scheduler: SegmentationCadenceScheduler,
  compositeCanvasRef: { current: HTMLCanvasElement | null },
  alphaScratchCanvasRef: { current: HTMLCanvasElement | null },
  eraseCanvasRef: { current: HTMLCanvasElement | null },
  // Phase H.1 Step 5's diagnostic ask: forces the SAME "no occlusion, just apply
  // opacity" fallback already used for a stale/missing mask below -- never a new
  // code path. `false` (the default) is byte-for-byte the pre-existing behavior.
  forceNoOcclusion = false
): HTMLCanvasElement | null {
  const maskAgeMs3d = scheduler.getLatestAgeMs(frameStartMs);
  const stale3d = forceNoOcclusion || isMaskStale(maskAgeMs3d, OCCLUSION_STALE_MASK_THRESHOLD_MS);
  const latestMask3d = scheduler.getLatest();

  if (!compositeCanvasRef.current) compositeCanvasRef.current = document.createElement("canvas");
  const compositeCanvas = compositeCanvasRef.current;
  if (compositeCanvas.width !== videoWidthPx || compositeCanvas.height !== videoHeightPx) {
    compositeCanvas.width = videoWidthPx;
    compositeCanvas.height = videoHeightPx;
  }
  const compositeCtx = compositeCanvas.getContext("2d");
  if (!compositeCtx) return null;

  if (!stale3d && latestMask3d) {
    const bboxPx3d = computeTransformedBoundingBox(transform, geometry);
    const region3d = toMaskSpaceRegion(bboxPx3d, transform.anchorPx.y, videoWidthPx, videoHeightPx, latestMask3d.maskWidthPx, latestMask3d.maskHeightPx);
    const categoryMask3d = computeNecklaceOcclusionMask(latestMask3d.categoryData, latestMask3d.maskWidthPx, latestMask3d.maskHeightPx, region3d);

    // Phase G Step 13/14: refine using the render's OWN real alpha, not just the
    // coarse category rule. `renderedCanvas` is already full-video-sized, so
    // downscaling it directly to the mask's resolution needs no region/crop math.
    let occlusionMask3d = categoryMask3d;
    if (!alphaScratchCanvasRef.current) alphaScratchCanvasRef.current = document.createElement("canvas");
    const alphaScratchCanvas3d = alphaScratchCanvasRef.current;
    if (alphaScratchCanvas3d.width !== latestMask3d.maskWidthPx || alphaScratchCanvas3d.height !== latestMask3d.maskHeightPx) {
      alphaScratchCanvas3d.width = latestMask3d.maskWidthPx;
      alphaScratchCanvas3d.height = latestMask3d.maskHeightPx;
    }
    const alphaScratchCtx3d = alphaScratchCanvas3d.getContext("2d");
    if (alphaScratchCtx3d) {
      alphaScratchCtx3d.clearRect(0, 0, latestMask3d.maskWidthPx, latestMask3d.maskHeightPx);
      alphaScratchCtx3d.drawImage(renderedCanvas, 0, 0, videoWidthPx, videoHeightPx, 0, 0, latestMask3d.maskWidthPx, latestMask3d.maskHeightPx);
      const { data: renderedRgba3d } = alphaScratchCtx3d.getImageData(0, 0, latestMask3d.maskWidthPx, latestMask3d.maskHeightPx);
      const renderedAlpha3d = new Uint8ClampedArray(latestMask3d.maskWidthPx * latestMask3d.maskHeightPx);
      for (let i = 0; i < renderedAlpha3d.length; i++) renderedAlpha3d[i] = renderedRgba3d[i * 4 + 3];
      occlusionMask3d = applyRenderedAlphaToOcclusionMask(categoryMask3d, renderedAlpha3d);
    }

    if (!eraseCanvasRef.current) eraseCanvasRef.current = document.createElement("canvas");
    const eraseCanvas3d = eraseCanvasRef.current;
    if (eraseCanvas3d.width !== latestMask3d.maskWidthPx || eraseCanvas3d.height !== latestMask3d.maskHeightPx) {
      eraseCanvas3d.width = latestMask3d.maskWidthPx;
      eraseCanvas3d.height = latestMask3d.maskHeightPx;
    }
    const eraseCtx3d = eraseCanvas3d.getContext("2d");
    if (!eraseCtx3d) return null;
    const eraseRgba3d = buildOcclusionEraseRgba(occlusionMask3d);
    eraseCtx3d.putImageData(new ImageData(eraseRgba3d as Uint8ClampedArray<ArrayBuffer>, latestMask3d.maskWidthPx, latestMask3d.maskHeightPx), 0, 0);
    compositeOccluded3dOverlay(compositeCtx, renderedCanvas, opacity, eraseCanvas3d, latestMask3d.maskWidthPx, latestMask3d.maskHeightPx, videoWidthPx, videoHeightPx);
    return compositeCanvas;
  }

  // Stale/missing mask -- same "no occlusion" fallback the 2D path uses (M6.4 Step
  // 13), never a stale/incorrect erase pattern.
  compositeCtx.clearRect(0, 0, videoWidthPx, videoHeightPx);
  compositeCtx.save();
  compositeCtx.globalAlpha = Math.max(0, Math.min(1, opacity));
  compositeCtx.drawImage(renderedCanvas, 0, 0);
  compositeCtx.restore();
  return compositeCanvas;
}

export interface UseLiveArSessionArgs {
  category: CategorySlug;
  jewelleryId: string | null;
  asset: AssetWithPreviewResponse | null;
  /** Explicit override for the geometry length-adjustment multiplier (geometry.ts's
   * computeNecklaceAnchor) -- almost never needed: M6.5's `primaryCategorySlug` +
   * measured asset geometry already resolve this automatically per item (see
   * jewellery-attachment.ts's resolveNecklaceAttachmentModel). Non-null here wins over
   * the automatic resolution, for a manual/diagnostic override. */
  necklaceLength?: string | null;
  /** M6.5 (jewellery-attachment.ts): the PRIMARY item's own catalogue category slug
   * (e.g. "necklace" or "haaram" -- from `JewelleryResponse.category.slug`), used to
   * resolve its attachment class (choker/necklace/haaram) and neck curvature. Only
   * consulted in necklace mode; harmless to pass for earrings. */
  primaryCategorySlug?: string | null;
  /** M6.5 spec Step 6: the PRIMARY item's own `JewelleryResponse.physical_width_mm`
   * (lives on the parent jewellery item, not the asset -- see asset-cache.ts's
   * computeGeometry doc comment). Feeds computeScale's existing, previously-dormant
   * physical-dimension scale path for BOTH categories, not just necklaces. */
  primaryPhysicalWidthMm?: number | null;
  /** Necklace-mode-only: further neck items worn AT THE SAME TIME as `asset` above
   * (e.g. a haaram layered under a necklace) -- see LiveArStudio's multi-select
   * "Choose pieces to layer" panel. Each is rendered with its own independent
   * tracking/smoothing state, progressively nudged further down the neck than the
   * previous one (constants.ts's NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH) so
   * simultaneously worn items land at visibly different depths. Empty/omitted outside
   * necklace mode -- unchanged single-item behavior. `categorySlug`/`physicalWidthMm`
   * (M6.5) are this item's OWN JewelleryResponse fields, same meaning as
   * `primaryCategorySlug`/`primaryPhysicalWidthMm` above. */
  additionalNecklaceItems?: {
    jewelleryId: string;
    asset: AssetWithPreviewResponse | null;
    categorySlug?: string | null;
    physicalWidthMm?: number | null;
  }[];
  /** Draws the necklace geometry debug overlay (face/shoulder/neck/jewellery attachment
   * points) and exposes the raw numeric snapshot via `debugSnapshot`. Diagnostic-only --
   * never affects the actual jewellery placement/rendering. */
  debugEnabled?: boolean;
  /** Diagnostic-only: live-previews NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH at a
   * different value (see neck-reference.ts's computeNeckReferenceFrame docstring),
   * so the calibration slider in LiveArStudio can be tuned against the real camera
   * without a Docker rebuild per attempt. `null`/`undefined` uses the shipped constant --
   * this DOES affect the actual rendered position while set, unlike debugEnabled. */
  debugNeckFractionOverride?: number | null;
  /** Same diagnostic-only convention as debugNeckFractionOverride, for the necklace
   * anchor's horizontal position (a fraction of shoulder width). `null`/`undefined`
   * means zero offset -- the plain shoulder midpoint, unchanged behavior. */
  debugNeckHorizontalOffsetOverride?: number | null;
  /** M6.3 (docs/live-ar-realism-architecture.md §6/§7/§17): draws the colorized
   * segmentation category mask on top of the video frame, AFTER the jewellery, for
   * visual inspection only. Never affects jewellery placement/compositing -- when
   * false (the default), nothing from M6.3 is drawn, and the customer-facing result is
   * byte-for-byte the same as before this milestone. The segmenter itself still loads
   * and runs on its own cadence regardless of this flag (see the module-level comment
   * above `useLiveArSession`'s render loop) so real timing data doesn't depend on this
   * panel happening to be open. */
  showSegmentationDebug?: boolean;
  /** M6.4 (docs/live-ar-realism-architecture.md §17): draws the occlusion debug
   * overlay (the final per-pixel occlusion decision for the current necklace, plus a
   * mask-age/tracking-state text readout). Independent of showSegmentationDebug above.
   * Never affects jewellery placement/compositing itself -- occlusion COMPOSITING
   * (unlike its debug visualization) is always active for necklace whenever a
   * fresh-enough mask exists, regardless of this flag; this flag only controls whether
   * you can SEE the decision being made. */
  showOcclusionDebug?: boolean;
  /** M6.6 spec Step 12 ("Comparison mode"): dev/debug-only, never exposed to
   * customers by default. When true, ALSO renders the necklace's M6.5-equivalent
   * (yaw forced to 0 -- angle-blind) appearance into `wearComparisonCanvasRef`, using
   * the SAME camera frame and jewellery the main canvas draws this frame, so the two
   * can be compared side by side without altering tracking/placement itself. */
  showWearComparison?: boolean;
  /** Phase H.1 (docs/2-5d-jewellery-surface-attachment.md's incident follow-up)
   * Step 5's explicit diagnostic ask: "temporarily disable ALL occlusion... if the
   * rectangle disappears, the occlusion pipeline is the bug." Unlike
   * `showOcclusionDebug` (which only controls whether the decision is VISUALIZED --
   * compositing itself is always on), this flag, when true, skips
   * `compositeRendered3dFrame`'s occlusion branch entirely for the 3D/2.5D path,
   * forcing the same "no occlusion, just apply opacity" fallback that already
   * exists for a stale/missing mask -- never a new code path, just an existing one
   * forced on. Dev/debug-only, defaults to false (unchanged behavior). */
  disable3dOcclusionForDebug?: boolean;
}

export interface UseLiveArSessionResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  mirrorTransform: string;
  cameraStatus: CameraStatus;
  cameraError: CameraError | null;
  trackersStatus: TrackersStatus;
  trackersError: string | null;
  assetLoading: boolean;
  assetError: string | null;
  trackingStatus: TrackingStatus;
  readiness: ReadinessResult<string> | null;
  performance: PerformanceSnapshot;
  /** Latest necklace geometry debug snapshot (see debug.ts), throttled to ~3/sec so the
   * numeric readout doesn't force a re-render every frame. Null when debugEnabled is
   * false, the category isn't "necklace", or there's no valid transform this frame. */
  debugSnapshot: NecklaceDebugSnapshot | null;
  /** M6.3: whether the multiclass ImageSegmenter proof-of-concept model has loaded.
   * "error" is non-fatal to the rest of the session (Step 17) -- camera/tracking/
   * jewellery rendering continue exactly as before regardless of this status. */
  segmentationStatus: "idle" | "loading" | "ready" | "error";
  segmentationError: string | null;
  /** M6.4 (docs/live-ar-realism-architecture.md §17): throttled diagnostic info for the
   * occlusion debug panel -- mask age, staleness, the tracking state occlusion
   * decisions were made against, and the real segmentation-category breakdown WITHIN
   * the necklace's own rendered region (2026-09-24 real-device review Step 7/8 --
   * "print percentage of necklace-region pixels classified as [each category]", so a
   * real device can show directly whether hair is even detected over the necklace,
   * rather than guessing from a screenshot). `distribution` is null exactly when there
   * was no fresh-enough mask to compute it against (stale/missing), same condition as
   * `occludedNecklaceCanvas` -- see the render loop. Null whenever there is no necklace
   * overlay to report on this frame at all (wrong category, no transform, etc.) --
   * never a stale/leftover value from a different frame's necklace. */
  occlusionDebugInfo: {
    maskAgeMs: number | null;
    maskCapturedAtMs: number | null;
    isStale: boolean;
    trackingStatus: TrackingStatus;
    distribution: CategoryDistribution | null;
    /** Null exactly when `distribution` is null (same condition -- no mask to derive
     * either from) OR when occlusion did not actually run this frame (stale mask),
     * since `finalVisiblePct` specifically reflects the mask occlusion ACTUALLY
     * applied, not a hypothetical one computed against a mask that was rejected as
     * stale. */
    hairOverlap: HairOverlapReport | null;
    /** 2026-09-24 controlled real-device validation Step 8: the corrected metrics,
     * scoped to the jewellery's ACTUAL alpha footprint rather than its bounding box --
     * same null-exactly-when-occlusion-actually-ran condition as `hairOverlap` above. */
    alphaOcclusionReport: JewelleryAlphaOcclusionReport | null;
    /** M6.4 real-device verification (2026-09-24) Step 2 item I: the literal answer to
     * "is occlusion actually being applied to the necklace on THIS frame" -- true only
     * when the mask was fresh enough and the erase/compositing path actually ran (i.e.
     * `occludedNecklaceCanvas` was produced), false whenever the necklace is drawn
     * un-occluded for any reason (stale/missing mask, no overlay). Never inferred by
     * the UI from other fields -- read directly off the same gate the render loop uses. */
    occlusionActive: boolean;
  } | null;
  /** Phase E Step 21: generic 3D debug info -- reflects whichever item currently has
   * a resolved 3D asset (see three-live-bridge.ts's registry), never a specific
   * item's own hardcoded fields. `status` distinguishes "this item has no 3D asset at
   * all" (`"none"`, the common case) from `"loading"`/`"error"`/`"rendered"`. Null
   * fields (`transform`/`stats`) mean exactly what they say -- no 3D frame was
   * actually rendered this tick, never a fabricated placeholder. */
  live3dDebugInfo: {
    status: "none" | "loading" | "error" | "webgl_unavailable" | "rendered";
    jewelleryId: string | null;
    attachmentType: string | null;
    /** Phase 2.5D Step 21: which representation actually produced this frame's
     * render -- the procedural GLB (dev-only today, `productionVerified: false` for
     * every real catalogue item) or the curved-textured-mesh path carrying the
     * item's REAL artwork. Null exactly when `status` is `"none"` (no 3D/2.5D asset
     * active this frame -- the flat-2D sprite is what's actually on screen). */
    representationMode: "gltf-3d" | "curved-2.5d" | null;
    transform: { positionMm: { x: number; y: number; z: number }; scale: number } | null;
    /** Phase F (docs/true-body-surface-jewellery-attachment.md Step 14): the real
     * orientation actually applied this frame -- `method` distinguishes a real
     * MediaPipe facial-transformation-matrix-derived pose from the 2D yaw-proxy
     * fallback, so a real-device tester can see directly which signal was in play. */
    orientation: { yawDegrees: number; pitchDegrees: number; rollDegrees: number; confidence: number; method: string } | null;
    stats: { drawCalls: number; triangles: number; textures: number; geometries: number } | null;
  } | null;
  /** M6.4 real-device review Step 2: a small canvas the render loop draws the FINAL
   * jewellery-visibility mask into (white = visible, black = occluded, always fully
   * opaque) -- render it directly via `<canvas ref={session.finalVisibilityMaskCanvasRef} />`
   * as a standalone picture-in-picture panel, never composited onto the camera feed
   * (see occlusion.ts's `buildFinalVisibilityMaskRgba` for why that's a separate view
   * from the semi-transparent in-place overlay `showOcclusionDebug` already draws).
   * Only updated while `showOcclusionDebug` is on and occlusion actually ran this
   * frame; stays at its last content otherwise (harmless -- it's not visible unless
   * the caller chooses to render it, which should itself be gated on the same flag). */
  finalVisibilityMaskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** 2026-09-24 controlled real-device validation Step 9/10: a small canvas the render
   * loop draws the green/red/blue/black jewellery-alpha diagnostic into (GREEN =
   * visible jewellery, RED = hair-over-jewellery, BLUE = clothing-over-jewellery
   * [above the attachment line], BLACK = no jewellery there at all) -- built from the
   * EXACT SAME masks the compositor used this frame, never a separate/fake
   * visualization. Same externally-rendered, standalone-panel convention as
   * `finalVisibilityMaskCanvasRef` above. */
  jewelleryAlphaDebugCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** M6.6 spec Step 12: a video-sized canvas the render loop draws the M6.5-equivalent
   * (yaw-blind, straight-on) necklace rendering into, from the SAME frame/transform the
   * main canvas used -- render it via `<canvas ref={session.wearComparisonCanvasRef} />`
   * next to the main view for an A/B comparison. Only updated while `showWearComparison`
   * is on; stays at its last content otherwise (same convention as the other debug
   * canvases above -- harmless since it's not visible unless the caller renders it). */
  wearComparisonCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Composites the CURRENT canvas (video + jewellery, already unmirrored -- see
   * coordinates.ts) into a single JPEG blob for the capture flow. Returns null if the
   * canvas isn't ready yet. */
  captureFrame: () => Promise<Blob | null>;
}

const DROPPED_FRAME_THRESHOLD_MS = 1000 / 20; // spec's 24fps-min target with headroom

export function useLiveArSession({
  category,
  jewelleryId,
  asset,
  necklaceLength = null,
  primaryCategorySlug = null,
  primaryPhysicalWidthMm = null,
  additionalNecklaceItems = [],
  debugEnabled = false,
  debugNeckFractionOverride = null,
  debugNeckHorizontalOffsetOverride = null,
  showSegmentationDebug = false,
  showOcclusionDebug = false,
  showWearComparison = false,
  disable3dOcclusionForDebug = false,
}: UseLiveArSessionArgs): UseLiveArSessionResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // M6.4 real-device review Step 2 -- rendered by the CALLER as a real <canvas>
  // element (same externally-owned pattern as canvasRef above), so the render loop
  // below draws into it only once it's actually mounted (null-checked, same as
  // videoRef/canvasRef already are).
  const finalVisibilityMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  // 2026-09-24 controlled real-device validation Step 9/10 -- same externally-owned
  // pattern as finalVisibilityMaskCanvasRef above (a standalone picture-in-picture
  // panel, not composited onto the camera feed).
  const jewelleryAlphaDebugCanvasRef = useRef<HTMLCanvasElement>(null);
  // M6.6 spec Step 12 -- same externally-owned pattern as the two canvases above.
  const wearComparisonCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackersRef = useRef<LiveTrackers | null>(null);
  // M6.3 -- see the render loop below for why loading/running is unconditional but
  // drawing is gated behind showSegmentationDebugRef.
  const segmenterRef = useRef<LiveSegmenter | null>(null);
  const segmentationSchedulerRef = useRef(new SegmentationCadenceScheduler(SEGMENTATION_INTERVAL_MS_DEFAULT));
  // One reused scratch canvas for the debug mask, created lazily on first use and
  // resized only when the mask's own native resolution changes -- never allocated
  // fresh per frame (Step 5).
  const segmentationDebugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // M6.4 -- reused offscreen buffers, never allocated per frame (Step 5). scratchRef
  // holds the necklace sprite + erase composite (video-sized); eraseMaskRef holds the
  // erase RGBA pattern at the segmentation mask's own native resolution;
  // debugCanvasRef holds the colorized "what's occluding" visualization, also at mask
  // resolution, only ever drawn when showOcclusionDebug is on.
  const occlusionScratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const occlusionEraseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const occlusionDebugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 2026-09-24 controlled real-device validation, Step 2/3: the jewellery's OWN real
  // alpha, transformed exactly like the visible sprite, so occlusion can be scoped to
  // "actually a jewellery pixel," not "somewhere inside the bounding box." localRef is
  // sized to the necklace's own on-screen bounding box (small -- never the full video)
  // and holds a plain, untransformed-opacity render of the sprite via the SAME
  // drawJewelleryOverlay used for the real draw (one source of truth for the
  // transform, per Step 3); regionRef is sized to the SAME clipped mask-space window
  // computeNecklaceOcclusionMask itself scans, and holds that render downscaled onto
  // that exact pixel grid, so its alpha channel lines up index-for-index with the
  // segmentation category data.
  const jewelleryAlphaLocalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const jewelleryAlphaRegionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Phase E: the generic 3D bridge (three-live-bridge.ts). threeRuntimeRef holds the
  // ONE persistent, offscreen Three.js renderer/scene/camera for the whole session
  // (created lazily on first use, never per frame or per item -- Step 17/20).
  // threeUnavailableRef is set true after ONE failed creation attempt (e.g. no WebGL2)
  // so it is never retried every frame -- the session simply stays on the 2D path.
  // loaded3dAssetRef holds the currently-selected item's loaded 3D asset, or null when
  // the current item has none (the common case today -- 2D fallback applies). The two
  // scratch canvases mirror occlusionScratchCanvasRef/occlusionEraseCanvasRef's own
  // existing "reused, resized only when needed" convention, kept separate from those
  // so the (unmodified) 2D occlusion path and the new 3D compositing path never fight
  // over the same buffer.
  const threeRuntimeRef = useRef<ThreeLiveRuntime | null>(null);
  const threeUnavailableRef = useRef(false);
  const loaded3dAssetRef = useRef<Live3dJewelleryAsset | null>(null);
  // Phase 2.5D: the curved-textured-mesh asset for the currently-selected item, or
  // null when none is registered/verified (the common case today -- only Diamond
  // Choker has one). Independent of loaded3dAssetRef -- the render loop below
  // decides priority (gltf-3d > curved-2.5d) at read time, never here.
  const loadedCurved25dAssetRef = useRef<Live25dJewelleryAsset | null>(null);
  const three3dCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const three3dEraseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Phase G Step 13/14: scratch canvas for downscaling the 3D render's OWN alpha to
  // the segmentation mask's resolution -- same "reused, resized only when needed"
  // convention as the other 3D scratch canvases above.
  const three3dAlphaScratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const assetGeometryRef = useRef<LoadedJewelleryTexture | null>(null);
  // Keyed by jewelleryId -- one loaded texture per additionally-layered neck item. Read
  // fresh every frame inside the render loop (never restarts it), updated by the
  // separate effect below whenever the selected set/preview URLs actually change.
  const additionalGeometryRef = useRef<Map<string, LoadedJewelleryTexture>>(new Map());
  const slotsRef = useRef<Map<string, SlotState>>(new Map());
  const performanceTrackerRef = useRef(new PerformanceTracker());
  const rafRef = useRef<number | null>(null);
  const lastFrameAtMsRef = useRef<number | null>(null);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [trackersStatus, setTrackersStatus] = useState<TrackersStatus>("idle");
  const [trackersError, setTrackersError] = useState<string | null>(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>("TRACKING_LOST");
  const [readiness, setReadiness] = useState<ReadinessResult<string> | null>(null);
  const [performanceSnapshot, setPerformanceSnapshot] = useState<PerformanceSnapshot>(performanceTrackerRef.current.snapshot());
  const [debugSnapshot, setDebugSnapshot] = useState<NecklaceDebugSnapshot | null>(null);
  const [segmentationStatus, setSegmentationStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [segmentationError, setSegmentationError] = useState<string | null>(null);
  const [occlusionDebugInfo, setOcclusionDebugInfo] = useState<UseLiveArSessionResult["occlusionDebugInfo"]>(null);
  // Phase E Step 21: generic 3D debug info -- null whenever no 3D asset is active for
  // the current item this frame (the common case), never a stale leftover value.
  const [live3dDebugInfo, setLive3dDebugInfo] = useState<UseLiveArSessionResult["live3dDebugInfo"]>(null);
  const lastLive3dDebugStateUpdateAtMsRef = useRef<number>(0);
  const lastDebugStateUpdateAtMsRef = useRef<number>(0);
  const lastOcclusionDebugStateUpdateAtMsRef = useRef<number>(0);
  const debugEnabledRef = useRef(debugEnabled);
  debugEnabledRef.current = debugEnabled;
  // Read fresh every frame -- toggling the debug checkbox must not tear down/restart
  // the render loop (same rationale as debugEnabledRef above).
  const showSegmentationDebugRef = useRef(showSegmentationDebug);
  showSegmentationDebugRef.current = showSegmentationDebug;
  const showOcclusionDebugRef = useRef(showOcclusionDebug);
  showOcclusionDebugRef.current = showOcclusionDebug;
  const showWearComparisonRef = useRef(showWearComparison);
  showWearComparisonRef.current = showWearComparison;
  const disable3dOcclusionForDebugRef = useRef(disable3dOcclusionForDebug);
  disable3dOcclusionForDebugRef.current = disable3dOcclusionForDebug;
  // Read fresh every frame from a ref (not render-loop-effect state) so dragging the
  // calibration slider doesn't tear down and restart tracking/smoothing state each tick.
  const debugNeckFractionOverrideRef = useRef(debugNeckFractionOverride);
  debugNeckFractionOverrideRef.current = debugNeckFractionOverride;
  const debugNeckHorizontalOffsetOverrideRef = useRef(debugNeckHorizontalOffsetOverride);
  debugNeckHorizontalOffsetOverrideRef.current = debugNeckHorizontalOffsetOverride;
  // Read fresh every frame, same rationale as the debug override refs above -- the
  // render loop effect below does not restart when this list changes (only textures,
  // loaded separately into additionalGeometryRef, need to be current; the ORDER here
  // determines each item's layering depth).
  const additionalNecklaceItemsRef = useRef(additionalNecklaceItems);
  additionalNecklaceItemsRef.current = additionalNecklaceItems;

  // Start the camera once per mount.
  useEffect(() => {
    let cancelled = false;
    setCameraStatus("starting");
    startLiveCamera().then((result) => {
      if (cancelled) {
        if (result.success) stopLiveCamera(result.stream);
        return;
      }
      if (!result.success) {
        setCameraError(result.error);
        setCameraStatus("error");
        return;
      }
      streamRef.current = result.stream;
      if (videoRef.current) videoRef.current.srcObject = result.stream;
      setCameraStatus("ready");
    });
    return () => {
      cancelled = true;
      stopLiveCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  // Phase E: dispose the persistent 3D runtime only when the session itself ends
  // (component unmount), never on a category/item change -- mirrors
  // disposeThreeRenderer's own "call when the Live AR session ends entirely, never
  // per jewellery-selection change" contract.
  useEffect(() => {
    return () => {
      if (threeRuntimeRef.current) {
        disposeThreeLiveRuntime(threeRuntimeRef.current);
        threeRuntimeRef.current = null;
      }
    };
  }, []);

  // Load MediaPipe trackers once per mount (see tracking.ts's docstring on why this
  // cannot be verified inside this project's own sandboxed CI environment).
  useEffect(() => {
    let cancelled = false;
    setTrackersStatus("loading");
    createLiveTrackers()
      .then((trackers) => {
        if (cancelled) {
          trackers.close();
          return;
        }
        trackersRef.current = trackers;
        setTrackersStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setTrackersError(err instanceof Error ? err.message : "Live tracking could not be started.");
        setTrackersStatus("error");
      });
    return () => {
      cancelled = true;
      trackersRef.current?.close();
      trackersRef.current = null;
    };
  }, []);

  // M6.3: load the multiclass ImageSegmenter proof-of-concept once per mount, the same
  // one-time lifecycle as the trackers effect above (Step 16). Deliberately NON-FATAL
  // on failure (Step 17): a segmentation load/init error only sets segmentationStatus
  // to "error" -- it never blocks camera/tracking/jewellery, which is exactly why this
  // effect neither reads nor sets any of that other state.
  useEffect(() => {
    let cancelled = false;
    // Captured once, up front, for the cleanup closure below -- this ref's `.current`
    // is only ever mutated by this scheduler's own methods after creation, never
    // reassigned to a different object, but capturing it locally avoids relying on
    // that invariant still holding by the time cleanup runs.
    const scheduler = segmentationSchedulerRef.current;
    setSegmentationStatus("loading");
    createLiveSegmenter()
      .then((live) => {
        if (cancelled) {
          live.close();
          return;
        }
        segmenterRef.current = live;
        setSegmentationStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setSegmentationError(err instanceof Error ? err.message : "Segmentation could not be started.");
        setSegmentationStatus("error");
      });
    return () => {
      cancelled = true;
      segmenterRef.current?.close();
      segmenterRef.current = null;
      scheduler.reset();
    };
  }, []);

  // Load (or reuse cached) the selected jewellery texture whenever the selection
  // changes -- never per frame (spec §11/§18).
  useEffect(() => {
    if (!asset || !asset.preview_url) {
      assetGeometryRef.current = null;
      return;
    }
    let cancelled = false;
    setAssetLoading(true);
    setAssetError(null);
    loadJewelleryAssetTexture(asset, asset.preview_url, primaryPhysicalWidthMm)
      .then((loaded) => {
        if (cancelled) return;
        assetGeometryRef.current = resolveLoadedTexture(loaded, category, primaryCategorySlug);
        setAssetLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        assetGeometryRef.current = null;
        setAssetError(err instanceof Error ? err.message : "Could not load this jewellery item.");
        setAssetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset, category, primaryCategorySlug, primaryPhysicalWidthMm]);

  // Phase E: load (or reuse cached) the PRIMARY item's 3D asset, if the generic
  // registry (three-live-bridge.ts) has one -- same "never per frame" discipline as
  // the 2D texture effect above, and completely independent of it: this resolves to
  // null for the overwhelming majority of items (no 3D asset yet), which the render
  // loop below treats identically to "no gltf3dAsset" (2D fallback, Step 2).
  useEffect(() => {
    let cancelled = false;
    if (!jewelleryId) {
      loaded3dAssetRef.current = null;
      return;
    }
    loadLive3dJewelleryAsset(jewelleryId)
      .then((loaded3d) => {
        if (cancelled) return;
        loaded3dAssetRef.current = loaded3d;
      })
      .catch(() => {
        if (cancelled) return;
        // Best-effort, same convention as the additional-layered-items loader below:
        // a failed 3D load simply falls back to 2D for this item, never breaks the
        // session (Step 25 item 15: "failed GLB loading fallback").
        loaded3dAssetRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [jewelleryId]);

  // Phase 2.5D: load (or reuse cached) the PRIMARY item's curved-2.5D asset, if the
  // generic registry (curved-2_5d-bridge.ts) has a production-verified one -- same
  // "never per frame" discipline as the GLTF loader above, and independent of it
  // (the render loop decides priority). Reuses the SAME already-loaded/cached
  // `HTMLImageElement` the flat-2D pipeline decoded (asset-cache.ts's own cache, keyed
  // by asset id) -- never a second fetch/decode of the artwork.
  useEffect(() => {
    let cancelled = false;
    if (!jewelleryId || !asset || !asset.preview_url) {
      loadedCurved25dAssetRef.current = null;
      return;
    }
    const metadata = resolveCurved25dAssetMetadata(jewelleryId);
    if (!metadata) {
      loadedCurved25dAssetRef.current = null;
      return;
    }
    loadJewelleryAssetTexture(asset, asset.preview_url, primaryPhysicalWidthMm)
      .then((loaded) => {
        if (cancelled) return;
        loadedCurved25dAssetRef.current = buildCurved25dAsset(metadata, loaded.image);
      })
      .catch(() => {
        if (cancelled) return;
        // Best-effort, same convention as the GLTF/additional-layered-items loaders:
        // a failed load simply falls back to flat-2D for this item.
        loadedCurved25dAssetRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [jewelleryId, asset, primaryPhysicalWidthMm]);

  // Same texture-loading pattern as the primary asset above, for each additionally
  // layered item. Keyed on a stable string derived from (id, preview_url) pairs rather
  // than the array itself, since the caller passes a freshly-built array every render.
  const additionalItemsKey = additionalNecklaceItems
    .map((item) => `${item.jewelleryId}:${item.asset?.preview_url ?? ""}:${item.categorySlug ?? ""}:${item.physicalWidthMm ?? ""}`)
    .join("|");
  useEffect(() => {
    let cancelled = false;
    const nextIds = new Set(additionalNecklaceItems.map((item) => item.jewelleryId));
    // Drop textures for items no longer selected.
    for (const id of additionalGeometryRef.current.keys()) {
      if (!nextIds.has(id)) additionalGeometryRef.current.delete(id);
    }
    for (const item of additionalNecklaceItems) {
      if (!item.asset || !item.asset.preview_url) continue;
      if (additionalGeometryRef.current.has(item.jewelleryId)) continue;
      loadJewelleryAssetTexture(item.asset, item.asset.preview_url, item.physicalWidthMm ?? null)
        .then((loaded) => {
          if (cancelled) return;
          // Additional layered neck items are only ever used in necklace mode (see
          // this prop's own doc comment) -- "necklace" is hardcoded here, not read from
          // the outer `category`, so an already-loaded additional item's attachment
          // model/strips don't need recomputing if the primary happened to switch to
          // earrings (additionalNecklaceItems would be empty then anyway).
          additionalGeometryRef.current.set(item.jewelleryId, resolveLoadedTexture(loaded, "necklace", item.categorySlug ?? null));
        })
        .catch(() => {
          // Best-effort: an additional layered item that fails to load simply doesn't
          // render (the primary item and any other successfully-loaded items still
          // do) -- never breaks the whole session over one extra item.
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [additionalItemsKey]);

  // Category changes reset per-slot tracking/smoothing state -- a left-earring's held
  // transform must never leak into a necklace's slot after switching categories.
  useEffect(() => {
    slotsRef.current = new Map();
  }, [category]);

  // The render loop.
  useEffect(() => {
    function loop(nowMs: number) {
      rafRef.current = requestAnimationFrame(loop);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const trackers = trackersRef.current;
      if (!video || !canvas || !trackers || video.readyState < 2) return;

      const frameStartMs = performance.now();
      const previousFrameAtMs = lastFrameAtMsRef.current;
      lastFrameAtMsRef.current = frameStartMs;
      const dtMs = previousFrameAtMs === null ? 16.7 : frameStartMs - previousFrameAtMs;

      const videoWidthPx = video.videoWidth;
      const videoHeightPx = video.videoHeight;
      if (videoWidthPx === 0 || videoHeightPx === 0) return;
      ensureCanvasSize(canvas, videoWidthPx, videoHeightPx);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const t0 = performance.now();
      const { face, pose, faceDetectMs, poseDetectMs } = detectFrameWithTiming(trackers, video, nowMs);
      const t1 = performance.now();

      // M6.3 (docs/live-ar-realism-architecture.md §6/§8/§17): segmentation runs on its
      // own cadence, independent of the jewellery tracking/geometry/render stages above
      // and below -- deliberately unconditional on showSegmentationDebug (see that
      // prop's own doc comment) so real timing data reflects the model's ongoing cost,
      // not just the cost while a human happens to have the debug panel open.
      // segmentationMs is null on a cadence-skipped frame -- see FrameSample's own doc
      // comment on why that must NOT be recorded as 0ms.
      let segmentationMs: number | null = null;
      const segmenter = segmenterRef.current;
      if (segmenter && segmentationSchedulerRef.current.shouldRun(frameStartMs)) {
        const segStart = performance.now();
        const segResult = runSegmentation(segmenter, video, nowMs);
        segmentationMs = performance.now() - segStart;
        segmentationSchedulerRef.current.recordRun(frameStartMs, segResult);
      }

      const loaded = assetGeometryRef.current;
      let overlays: {
        image: HTMLImageElement;
        transform: LiveTransform;
        opacity: number;
        strips: JewelleryStrip[] | null;
        horizontalForeshorten: number;
        contactPeakFraction: number;
      }[] = [];
      let primaryStatus: TrackingStatus = "TRACKING_LOST";

      // M6.6 (docs/live-ar-realism-verification.md §19): estimated ONCE per frame (not
      // once per neck item -- every simultaneously-worn item shares the same head, so
      // the same yaw estimate applies to all of them) and recomputed every frame,
      // unlike M6.5's per-asset-load-cached strips, because head yaw changes
      // continuously. Falls back to 0 (M6.5's exact straight-on assumption) when no
      // face is tracked this frame -- never a fabricated angle.
      const yawAsymmetry = estimateHeadYawAsymmetry(face) ?? 0;
      // M6.6 spec Step 14: real, measured cost of this frame's strip/foreshorten
      // recomputation (a SUBSET of geometryMs -- see FrameSample.deformationMs's own
      // doc comment), accumulated across the primary item and every additional layered
      // item. Stays null (never 0) on a frame where nothing actually ran the real
      // computation (earrings mode, or no necklace overlay) -- same convention as
      // segmentationMs/occlusionMs/alphaMaskMs.
      let deformationMs: number | null = null;
      const deformationFor = (texture: LoadedJewelleryTexture) => {
        if (!texture.attachmentModel) return { strips: null, horizontalForeshorten: 1, contactPeakFraction: 0.5 };
        const start = performance.now();
        const plan = computeJewelleryStrips(texture.geometry, texture.attachmentModel.curvature, yawAsymmetry);
        deformationMs = (deformationMs ?? 0) + (performance.now() - start);
        return plan;
      };

      if (loaded) {
        // M6.5: an explicit necklaceLength override (rare -- see its own doc comment)
        // wins; otherwise use the length this item's OWN attachment model resolved
        // (null for earrings -- planCategoryRenders' length param is a no-op there).
        const resolvedNecklaceLength = necklaceLength ?? loaded.attachmentModel?.necklaceLengthKey ?? null;
        const plans = planCategoryRenders(
          category,
          loaded.geometry,
          face,
          pose,
          videoWidthPx,
          videoHeightPx,
          resolvedNecklaceLength,
          debugNeckFractionOverrideRef.current ?? undefined,
          debugNeckHorizontalOffsetOverrideRef.current ?? undefined
        );
        const deformation = deformationFor(loaded);
        overlays = plans.flatMap((plan, index) => {
          let slot = slotsRef.current.get(plan.slot);
          if (!slot) {
            slot = makeSlotState();
            slotsRef.current.set(plan.slot, slot);
          }
          const smoothed = plan.transform ? smoothTransform(slot.smoother, plan.transform, dtMs) : null;
          const result = slot.trackingMachine.update(frameStartMs, smoothed);
          if (index === 0) primaryStatus = result.status;
          if (result.transform === null || result.opacity <= 0) return [];
          return [
            {
              image: loaded.image,
              transform: result.transform,
              opacity: result.opacity,
              strips: deformation.strips,
              horizontalForeshorten: deformation.horizontalForeshorten,
              contactPeakFraction: deformation.contactPeakFraction,
            },
          ];
        });
      }

      // Additional layered neck items (e.g. a haaram worn under a necklace) -- each
      // gets its own independent tracking/smoothing slot (keyed by jewelleryId, never
      // the primary's fixed "necklace" slot) and a progressively larger vertical nudge
      // so simultaneously worn items land at visibly different depths instead of
      // rendering on top of each other.
      if (category === "necklace") {
        additionalNecklaceItemsRef.current.forEach((item, additionalIndex) => {
          const additionalLoaded = additionalGeometryRef.current.get(item.jewelleryId);
          if (!additionalLoaded) return;
          const plans = planCategoryRenders(
            "necklace",
            additionalLoaded.geometry,
            face,
            pose,
            videoWidthPx,
            videoHeightPx,
            necklaceLength ?? additionalLoaded.attachmentModel?.necklaceLengthKey ?? null,
            debugNeckFractionOverrideRef.current ?? undefined,
            debugNeckHorizontalOffsetOverrideRef.current ?? undefined,
            (additionalIndex + 1) * NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH
          );
          const slotKey = `necklace:${item.jewelleryId}`;
          let slot = slotsRef.current.get(slotKey);
          if (!slot) {
            slot = makeSlotState();
            slotsRef.current.set(slotKey, slot);
          }
          const plan = plans[0];
          const smoothed = plan?.transform ? smoothTransform(slot.smoother, plan.transform, dtMs) : null;
          const result = slot.trackingMachine.update(frameStartMs, smoothed);
          if (result.transform === null || result.opacity <= 0) return;
          const deformation = deformationFor(additionalLoaded);
          overlays.push({
            image: additionalLoaded.image,
            transform: result.transform,
            opacity: result.opacity,
            strips: deformation.strips,
            horizontalForeshorten: deformation.horizontalForeshorten,
            contactPeakFraction: deformation.contactPeakFraction,
          });
        });
      }
      const t2 = performance.now();

      // Phase E / Phase 2.5D: the generic 3D/2.5D bridge. Only ever considered for
      // the PRIMARY necklace overlay (same scoping as the 2D occlusion block below,
      // and for the same reason -- this phase's own stop condition validates
      // necklace/choker first). Resolves to null (falls back to the existing flat-2D
      // sprite, unconditionally) whenever: the current item has no registered
      // gltf-3d OR curved-2.5d asset, its attachmentType isn't one this runtime
      // tracks live yet, tracking itself is lost this frame, or no WebGL2 context is
      // available -- never a silent partial render. Priority when BOTH happen to be
      // registered: gltf-3d wins (richer representation -- same rule
      // jewellery-representation.ts's resolveJewelleryRepresentation enforces), but
      // in practice today this is moot: the only production-verified gltf-3d entry
      // was reverted to `productionVerified: false` (docs/diamond-choker-asset-
      // restoration.md), so Diamond Choker resolves via curved-2.5d here.
      let occluded3dCanvas: HTMLCanvasElement | null = null;
      let live3dInfoThisFrame: UseLiveArSessionResult["live3dDebugInfo"] = null;
      // Phase G Step 15: 2D-projected neck-surface debug points, computed inside the
      // 3D block below (same frame, same runtime.camera) and consumed by the debug-
      // overlay drawing further down the loop -- a local, not a ref, since nothing
      // here needs to persist across frames.
      let neckSurfaceDebugPoints: { outlinePx: { x: number; y: number }[]; frontPx: { x: number; y: number }; normalEndPx: { x: number; y: number }; attachmentPx: { x: number; y: number } } | null = null;
      if (category === "necklace" && loaded && overlays.length > 0) {
        const primaryOverlay = overlays[0];
        const asset3d = loaded3dAssetRef.current;
        const trackedCategoryFor3d = asset3d ? attachmentTypeToTrackedCategory(asset3d.metadata.attachmentType) : null;
        const curved25dAsset = loadedCurved25dAssetRef.current;
        const trackedCategoryForCurved25d = curved25dAsset ? attachmentTypeToTrackedCategory(curved25dAsset.metadata.attachmentType) : null;
        const activeGltf3d = asset3d && trackedCategoryFor3d === "necklace" ? asset3d : null;
        const activeCurved25d = !activeGltf3d && curved25dAsset && trackedCategoryForCurved25d === "necklace" ? curved25dAsset : null;

        if (activeGltf3d || activeCurved25d) {
          if (!threeRuntimeRef.current && !threeUnavailableRef.current) {
            try {
              threeRuntimeRef.current = createThreeLiveRuntime();
            } catch {
              threeUnavailableRef.current = true;
            }
          }
          const runtime = threeRuntimeRef.current;
          const representationMode: "gltf-3d" | "curved-2.5d" = activeGltf3d ? "gltf-3d" : "curved-2.5d";
          const activeAttachmentType = activeGltf3d ? activeGltf3d.metadata.attachmentType : activeCurved25d!.metadata.attachmentType;
          const activePhysicalWidthMm = activeGltf3d ? activeGltf3d.metadata.physicalWidthMm : activeCurved25d!.metadata.physicalWidthMm;
          if (runtime) {
            // Phase F (docs/true-body-surface-jewellery-attachment.md): a real 3D
            // orientation (yaw+pitch from MediaPipe's own facial transformation
            // matrix when available, roll from the real shoulder-line tilt) drives
            // the mesh's rotation -- replacing Phase E's yaw-proxy-only, pitch-
            // always-0 orientation, which is the diagnosed root cause of the
            // "floating filter" look. Position/scale are unchanged from Phase E.
            // "necklace" always has a registered resolver (body-attachment.ts) --
            // the non-null assertion reflects that structural fact, not an unchecked
            // assumption about tracking data (resolveNeckAttachmentOrientation
            // itself degrades gracefully to a neutral orientation when face/pose are
            // both null, see that function's own tests).
            const orientation = resolveAttachmentOrientation("necklace", face, pose, videoWidthPx, videoHeightPx)!;
            let renderedCanvas: HTMLCanvasElement | null;
            if (activeGltf3d) {
              renderedCanvas = renderSurfaceAttachedFrame(runtime, activeGltf3d, primaryOverlay.transform, loaded.geometry, orientation, videoWidthPx, videoHeightPx);
            } else if (activeCurved25d) {
              renderedCanvas = renderCurved25dFrame(runtime, activeCurved25d, primaryOverlay.transform, loaded.geometry, orientation, videoWidthPx, videoHeightPx);
            } else {
              renderedCanvas = null; // unreachable -- the outer `if (activeGltf3d || activeCurved25d)` guarantees one of the two branches above ran
            }

            // Phase G Step 4/6/7: the real parametric neck surface. `runtime.
            // currentInstance.position` is the SAME attachment point
            // computeSurfaceAttachedTransform just computed (Phase F/E's already-
            // validated position, unchanged) -- treated as the ellipse's own FRONT
            // surface point (see neck-surface-3d.ts's file docstring for why).
            // `pxPerMm3d` reuses the SAME calibration already trusted for the
            // jewellery's own physical scale; `neckWidthPx` is the EXISTING (M6.2)
            // neck-reference width estimate -- no new tracking, no new landmarks.
            // Generic over WHICH representation is active (`activePhysicalWidthMm`)
            // -- both go through the SAME `runtime.currentInstance`.
            if (debugEnabledRef.current && runtime.currentInstance) {
              const scale3d = deriveScaleResultFromSmoothedTransform(primaryOverlay.transform, loaded.geometry);
              const pxPerMm3d = derivePxPerMm(scale3d.targetWidthPx, activePhysicalWidthMm);
              const neckReferenceFrame3d = computeNeckReferenceFrame(face, pose, videoWidthPx, videoHeightPx);
              const frontSurfaceMm = { x: runtime.currentInstance.position.x, y: runtime.currentInstance.position.y, z: runtime.currentInstance.position.z };
              const neckFrame: NeckSurfaceFrame | null = computeNeckSurfaceFrame(
                frontSurfaceMm,
                orientation,
                neckReferenceFrame3d?.widthPx ?? null,
                pxPerMm3d,
                orientation.confidence
              );
              if (neckFrame) {
                const ANGLE_SAMPLES = 24;
                const outlinePx = Array.from({ length: ANGLE_SAMPLES }, (_, i) => {
                  const angle = (i / ANGLE_SAMPLES) * Math.PI * 2;
                  const surfacePoint = neckSurfacePointAt(neckFrame, angle);
                  return projectPointToScreen(surfacePoint.position, runtime.camera, videoWidthPx, videoHeightPx);
                });
                const front = neckSurfacePointAt(neckFrame, 0);
                const frontPx = projectPointToScreen(front.position, runtime.camera, videoWidthPx, videoHeightPx);
                const NORMAL_VISUAL_LENGTH_MM = 30; // arbitrary DRAWING length, not a physical claim -- long enough to see the line, never fed back into any placement math
                const normalEndPx = projectPointToScreen(
                  { x: front.position.x + front.normal.x * NORMAL_VISUAL_LENGTH_MM, y: front.position.y + front.normal.y * NORMAL_VISUAL_LENGTH_MM, z: front.position.z + front.normal.z * NORMAL_VISUAL_LENGTH_MM },
                  runtime.camera,
                  videoWidthPx,
                  videoHeightPx
                );
                const attachmentPx = projectPointToScreen(frontSurfaceMm, runtime.camera, videoWidthPx, videoHeightPx);
                neckSurfaceDebugPoints = { outlinePx, frontPx, normalEndPx, attachmentPx };
              }
            }

            if (renderedCanvas) {
              // Reuse the EXISTING category-level occlusion mask machinery, via
              // compositeRendered3dFrame (extracted above from M6.8's original
              // inline block, generic over gltf-3d/curved-2.5d -- see that
              // function's own doc comment). HONEST SIMPLIFICATION (docs/
              // live-3d-jewellery-integration.md has the full account): this uses
              // the COARSE category mask refined by the render's own alpha, not the
              // 2D path's own finer jewellery-alpha-refined mask below (that
              // refinement is specifically shaped around the 2D sprite's own alpha
              // channel) -- still a real, existing, unmodified occlusion mechanism.
              occluded3dCanvas = compositeRendered3dFrame(
                renderedCanvas,
                primaryOverlay.transform,
                primaryOverlay.opacity,
                loaded.geometry,
                videoWidthPx,
                videoHeightPx,
                frameStartMs,
                segmentationSchedulerRef.current,
                three3dCompositeCanvasRef,
                three3dAlphaScratchCanvasRef,
                three3dEraseCanvasRef,
                disable3dOcclusionForDebugRef.current
              );

              const stats = getThreeRenderStats(runtime.renderer.info);
              live3dInfoThisFrame = {
                status: "rendered",
                jewelleryId,
                attachmentType: activeAttachmentType,
                representationMode,
                transform: {
                  positionMm: { x: runtime.currentInstance?.position.x ?? 0, y: runtime.currentInstance?.position.y ?? 0, z: runtime.currentInstance?.position.z ?? 0 },
                  scale: runtime.currentInstance?.scale.x ?? 0,
                },
                orientation: {
                  yawDegrees: (orientation.yawRadians * 180) / Math.PI,
                  pitchDegrees: (orientation.pitchRadians * 180) / Math.PI,
                  rollDegrees: (orientation.rollRadians * 180) / Math.PI,
                  confidence: orientation.confidence,
                  method: orientation.method,
                },
                stats,
              };
            } else {
              live3dInfoThisFrame = { status: "error", jewelleryId, attachmentType: activeAttachmentType, representationMode, transform: null, orientation: null, stats: null };
            }
          } else if (threeUnavailableRef.current) {
            live3dInfoThisFrame = { status: "webgl_unavailable", jewelleryId, attachmentType: activeAttachmentType, representationMode, transform: null, orientation: null, stats: null };
          }
        }
      }
      if (frameStartMs - lastLive3dDebugStateUpdateAtMsRef.current >= DEBUG_SNAPSHOT_STATE_THROTTLE_MS) {
        lastLive3dDebugStateUpdateAtMsRef.current = frameStartMs;
        setLive3dDebugInfo(live3dInfoThisFrame);
      }

      // M6.4 (docs/live-ar-realism-architecture.md §6/§7/§17): segmentation-aware
      // necklace occlusion. Applies ONLY to the primary necklace overlay (overlays[0]
      // when category === "necklace" -- the necklace slot is always constructed first
      // in the block above, before any additional layered items are pushed).
      // Earrings and additional layered neck items are intentionally out of scope for
      // this milestone (Step 4 of the request that produced it: "start with
      // necklace... do not expand to every jewellery category yet").
      //
      // Step 14's tracking-loss requirement needs no extra code here: `overlays[0]`
      // simply does not exist on a frame where the necklace's own tracking is LOST
      // (see the flatMap above -- `if (result.transform === null ...) return []`), so
      // this whole block is naturally skipped then, exactly as if occlusion were
      // "disabled" -- there is nothing to occlude.
      //
      // Phase E: skipped entirely when the 3D path already produced this frame's
      // primary overlay (occluded3dCanvas above) -- its result would only be thrown
      // away in the final draw step below, so computing it at all would be pure
      // waste (Step 20: "no unnecessary allocations per frame").
      let occlusionMs: number | null = null;
      let alphaMaskMs: number | null = null;
      let occludedNecklaceCanvas: HTMLCanvasElement | null = null;
      if (category === "necklace" && loaded && overlays.length > 0 && !occluded3dCanvas) {
        const necklaceOverlay = overlays[0];
        const maskAgeMs = segmentationSchedulerRef.current.getLatestAgeMs(frameStartMs);
        const stale = isMaskStale(maskAgeMs, OCCLUSION_STALE_MASK_THRESHOLD_MS);
        const latestMask = segmentationSchedulerRef.current.getLatest();

        // M6.4 real-device review (2026-09-24) Step 7/8: the region and the real
        // category breakdown within it are computed whenever ANY mask exists --
        // regardless of staleness -- because this is a diagnostic answering "is hair
        // even detected over the necklace at all," which is useful to see even while
        // occlusion itself is (correctly) not being applied to a stale mask.
        let distribution: ReturnType<typeof computeCategoryDistribution> | null = null;
        let region: ReturnType<typeof toMaskSpaceRegion> | null = null;
        if (latestMask) {
          const bboxPx = computeTransformedBoundingBox(necklaceOverlay.transform, loaded.geometry);
          region = toMaskSpaceRegion(
            bboxPx,
            necklaceOverlay.transform.anchorPx.y,
            videoWidthPx,
            videoHeightPx,
            latestMask.maskWidthPx,
            latestMask.maskHeightPx
          );
          distribution = computeCategoryDistribution(latestMask.categoryData, latestMask.maskWidthPx, latestMask.maskHeightPx, region);
        }

        // 2026-09-24 controlled real-device validation Step 2/4: "final jewellery
        // visible percentage" and "HAIR/NECKLACE OVERLAP" reflect the mask ACTUALLY
        // applied, so this is populated inside the !stale branch below (once
        // `occlusionMask` exists) and the throttled debugInfo dispatch happens AFTER
        // that branch runs, using whatever value it ended up setting.
        let hairOverlap: HairOverlapReport | null = null;
        let alphaOcclusionReport: JewelleryAlphaOcclusionReport | null = null;

        // Step 13: a stale or missing mask falls back to NO occlusion (the necklace
        // draws exactly as it did before M6.4) rather than trusting old data or
        // hiding the necklace outright.
        if (!stale && latestMask && region) {
          const occStart = performance.now();
          const categoryOcclusionMask = computeNecklaceOcclusionMask(
            latestMask.categoryData,
            latestMask.maskWidthPx,
            latestMask.maskHeightPx,
            region
          );

          // 2026-09-24 controlled real-device validation, Step 1-3: the central
          // correction. Render the jewellery's OWN real alpha through the IDENTICAL
          // transform used to draw it (drawJewelleryOverlay -- one source of truth,
          // never a duplicated transform, per Step 3), into a canvas sized to its own
          // on-screen bounding box (small, never the full video -- Step 13's "only
          // transform/composite the required region"). Then downscale that directly
          // onto the exact clipped mask-space grid computeNecklaceOcclusionMask itself
          // scanned, so the two line up index-for-index without a second coordinate
          // remapping pass.
          const alphaStart = performance.now();
          let occlusionMask = categoryOcclusionMask;
          const clip = clipRegionToMask(region, latestMask.maskWidthPx, latestMask.maskHeightPx);
          if (clip.width > 0 && clip.height > 0) {
            const bboxPx = computeTransformedBoundingBox(necklaceOverlay.transform, loaded.geometry);
            const bboxWidthPx = Math.max(1, Math.ceil(bboxPx[2] - bboxPx[0]));
            const bboxHeightPx = Math.max(1, Math.ceil(bboxPx[3] - bboxPx[1]));

            if (!jewelleryAlphaLocalCanvasRef.current) jewelleryAlphaLocalCanvasRef.current = document.createElement("canvas");
            const localCanvas = jewelleryAlphaLocalCanvasRef.current;
            if (localCanvas.width !== bboxWidthPx || localCanvas.height !== bboxHeightPx) {
              localCanvas.width = bboxWidthPx;
              localCanvas.height = bboxHeightPx;
            }
            const localCtx = localCanvas.getContext("2d");

            if (!jewelleryAlphaRegionCanvasRef.current) jewelleryAlphaRegionCanvasRef.current = document.createElement("canvas");
            const alphaRegionCanvas = jewelleryAlphaRegionCanvasRef.current;
            if (alphaRegionCanvas.width !== clip.width || alphaRegionCanvas.height !== clip.height) {
              alphaRegionCanvas.width = clip.width;
              alphaRegionCanvas.height = clip.height;
            }
            const alphaRegionCtx = alphaRegionCanvas.getContext("2d");

            if (localCtx && alphaRegionCtx) {
              localCtx.clearRect(0, 0, bboxWidthPx, bboxHeightPx);
              // Shift the anchor so the bbox's own top-left lands at this local
              // canvas's (0,0) -- the ONLY difference from the real transform, which
              // otherwise draws identically (same scale/rotation/mirror/source anchor).
              const localTransform: LiveTransform = {
                ...necklaceOverlay.transform,
                anchorPx: {
                  x: necklaceOverlay.transform.anchorPx.x - bboxPx[0],
                  y: necklaceOverlay.transform.anchorPx.y - bboxPx[1],
                },
              };
              drawJewelleryOverlay(localCtx, necklaceOverlay.image, localTransform, 1, necklaceOverlay.strips, necklaceOverlay.horizontalForeshorten);

              // Downscale (general case, including a bbox partially clipped by the
              // mask/frame edge): computeAlphaDownscaleSourceRect (occlusion.ts, pure,
              // directly unit-tested) maps the clipped region's own pixel grid back to
              // the exact fractional sub-rectangle of the local canvas it corresponds
              // to -- never a second, ad hoc transform.
              const { sx, sy, sw, sh } = computeAlphaDownscaleSourceRect(
                region,
                clip,
                videoWidthPx,
                videoHeightPx,
                latestMask.maskWidthPx,
                latestMask.maskHeightPx
              );
              alphaRegionCtx.clearRect(0, 0, clip.width, clip.height);
              alphaRegionCtx.drawImage(localCanvas, sx, sy, sw, sh, 0, 0, clip.width, clip.height);

              const jewelleryAlphaAtRegion = new Uint8ClampedArray(clip.width * clip.height);
              const { data } = alphaRegionCtx.getImageData(0, 0, clip.width, clip.height);
              for (let i = 0; i < jewelleryAlphaAtRegion.length; i++) jewelleryAlphaAtRegion[i] = data[i * 4 + 3];

              occlusionMask = applyJewelleryAlphaToOcclusionMask(
                categoryOcclusionMask,
                latestMask.maskWidthPx,
                latestMask.maskHeightPx,
                region,
                jewelleryAlphaAtRegion
              );
              alphaOcclusionReport = computeJewelleryAlphaOcclusionReport(
                latestMask.categoryData,
                occlusionMask,
                latestMask.maskWidthPx,
                latestMask.maskHeightPx,
                region,
                jewelleryAlphaAtRegion
              );

              // Debug-only (Step 9): the green/red/blue/black visualization, built
              // from the SAME categoryData/jewelleryAlphaAtRegion the compositor just
              // used -- never a separate/fake visualization path.
              const alphaDebugCanvas = jewelleryAlphaDebugCanvasRef.current;
              if (showOcclusionDebugRef.current && alphaDebugCanvas) {
                if (alphaDebugCanvas.width !== latestMask.maskWidthPx || alphaDebugCanvas.height !== latestMask.maskHeightPx) {
                  alphaDebugCanvas.width = latestMask.maskWidthPx;
                  alphaDebugCanvas.height = latestMask.maskHeightPx;
                }
                const alphaDebugCtx = alphaDebugCanvas.getContext("2d");
                if (alphaDebugCtx) {
                  const alphaDebugRgba = buildJewelleryAlphaDebugRgba(
                    latestMask.categoryData,
                    occlusionMask,
                    latestMask.maskWidthPx,
                    latestMask.maskHeightPx,
                    region,
                    jewelleryAlphaAtRegion
                  );
                  alphaDebugCtx.putImageData(
                    new ImageData(alphaDebugRgba as Uint8ClampedArray<ArrayBuffer>, latestMask.maskWidthPx, latestMask.maskHeightPx),
                    0,
                    0
                  );
                }
              }
            }
          }
          alphaMaskMs = performance.now() - alphaStart;

          if (distribution) {
            hairOverlap = computeHairOverlapReport(occlusionMask, latestMask.maskWidthPx, latestMask.maskHeightPx, region, distribution);
          }

          if (!occlusionEraseCanvasRef.current) occlusionEraseCanvasRef.current = document.createElement("canvas");
          const eraseCanvas = occlusionEraseCanvasRef.current;
          if (eraseCanvas.width !== latestMask.maskWidthPx || eraseCanvas.height !== latestMask.maskHeightPx) {
            eraseCanvas.width = latestMask.maskWidthPx;
            eraseCanvas.height = latestMask.maskHeightPx;
          }
          const eraseCtx = eraseCanvas.getContext("2d");

          if (!occlusionScratchCanvasRef.current) occlusionScratchCanvasRef.current = document.createElement("canvas");
          const scratchCanvas = occlusionScratchCanvasRef.current;
          if (scratchCanvas.width !== videoWidthPx || scratchCanvas.height !== videoHeightPx) {
            scratchCanvas.width = videoWidthPx;
            scratchCanvas.height = videoHeightPx;
          }
          const scratchCtx = scratchCanvas.getContext("2d");

          if (eraseCtx && scratchCtx) {
            const eraseRgba = buildOcclusionEraseRgba(occlusionMask);
            eraseCtx.putImageData(
              new ImageData(eraseRgba as Uint8ClampedArray<ArrayBuffer>, latestMask.maskWidthPx, latestMask.maskHeightPx),
              0,
              0
            );
            drawOccludedJewelleryOverlay(
              scratchCtx,
              necklaceOverlay.image,
              necklaceOverlay.transform,
              necklaceOverlay.opacity,
              eraseCanvas,
              latestMask.maskWidthPx,
              latestMask.maskHeightPx,
              videoWidthPx,
              videoHeightPx,
              necklaceOverlay.strips,
              necklaceOverlay.horizontalForeshorten
            );
            occludedNecklaceCanvas = scratchCanvas;

            // Debug-only (Step 15/16): colorize the SAME occlusion decision just made,
            // for the "final jewellery visibility mask" panel -- never a re-derivation.
            if (showOcclusionDebugRef.current) {
              if (!occlusionDebugCanvasRef.current) occlusionDebugCanvasRef.current = document.createElement("canvas");
              const debugCanvas = occlusionDebugCanvasRef.current;
              if (debugCanvas.width !== latestMask.maskWidthPx || debugCanvas.height !== latestMask.maskHeightPx) {
                debugCanvas.width = latestMask.maskWidthPx;
                debugCanvas.height = latestMask.maskHeightPx;
              }
              const debugCtx = debugCanvas.getContext("2d");
              if (debugCtx) {
                const debugRgba = buildOcclusionDebugRgba(occlusionMask);
                debugCtx.putImageData(
                  new ImageData(debugRgba as Uint8ClampedArray<ArrayBuffer>, latestMask.maskWidthPx, latestMask.maskHeightPx),
                  0,
                  0
                );
              }

              // M6.4 real-device review Step 2: the standalone white/black
              // final-visibility-mask panel -- literally the complement of the erase
              // pattern just applied above, drawn into the externally-rendered
              // finalVisibilityMaskCanvasRef (a real <canvas> the caller renders in
              // JSX, not an internal offscreen buffer) so it can be shown as its own
              // picture-in-picture thumbnail rather than composited onto the camera.
              const visibilityCanvas = finalVisibilityMaskCanvasRef.current;
              if (visibilityCanvas) {
                if (visibilityCanvas.width !== latestMask.maskWidthPx || visibilityCanvas.height !== latestMask.maskHeightPx) {
                  visibilityCanvas.width = latestMask.maskWidthPx;
                  visibilityCanvas.height = latestMask.maskHeightPx;
                }
                const visibilityCtx = visibilityCanvas.getContext("2d");
                if (visibilityCtx) {
                  const visibilityRgba = buildFinalVisibilityMaskRgba(occlusionMask);
                  visibilityCtx.putImageData(
                    new ImageData(
                      visibilityRgba as Uint8ClampedArray<ArrayBuffer>,
                      latestMask.maskWidthPx,
                      latestMask.maskHeightPx
                    ),
                    0,
                    0
                  );
                }
              }
            }
          }
          occlusionMs = performance.now() - occStart;
        }

        const debugInfo = {
          maskAgeMs,
          maskCapturedAtMs: segmentationSchedulerRef.current.getLatestCapturedAtMs(),
          isStale: stale,
          trackingStatus: primaryStatus,
          distribution,
          hairOverlap,
          alphaOcclusionReport,
          occlusionActive: occludedNecklaceCanvas !== null,
        };
        if (frameStartMs - lastOcclusionDebugStateUpdateAtMsRef.current >= DEBUG_SNAPSHOT_STATE_THROTTLE_MS) {
          lastOcclusionDebugStateUpdateAtMsRef.current = frameStartMs;
          setOcclusionDebugInfo(debugInfo);
        }
      } else {
        // Wrong category / no necklace overlay this frame -- clear promptly rather
        // than leaving a previous frame's stale info displayed (this transition is
        // rare -- category switch, tracking loss -- so skipping the usual throttle
        // here is not a performance concern). Unconditional: React's own setState
        // bails out without a re-render when the value is already null, so there is
        // no need to read the current state value inside this closure to decide
        // whether to call it (which would need `occlusionDebugInfo` in this effect's
        // dependency array, tearing down/restarting the render loop on every change).
        setOcclusionDebugInfo(null);
      }
      // Marks the actual start of rendering, AFTER occlusion's own computation --
      // otherwise occlusionMs's time would be silently double-counted inside renderMs
      // below (t2 was captured before occlusion ran, t3 is captured after rendering).
      const t2Render = performance.now();

      renderLiveFrame(ctx, { video, videoWidthPx, videoHeightPx }, null);
      overlays.forEach((overlay, index) => {
        // Phase E: the primary overlay draws from the 3D composite whenever the 3D
        // path actually produced one this frame (a real GLB, generically resolved --
        // see three-live-bridge.ts) -- this is the ONLY place "3D vs 2D" is decided
        // for what actually reaches the screen, and it is a plain null-check, not an
        // item-specific branch. Otherwise: the primary necklace overlay draws from
        // the occlusion-composited offscreen canvas when 2D occlusion ran this frame;
        // every other overlay (earrings, additional layered neck items, or the
        // necklace itself when neither ran) draws exactly as it did before M6.4/E.
        if (index === 0 && occluded3dCanvas) {
          ctx.drawImage(occluded3dCanvas, 0, 0);
        } else if (index === 0 && occludedNecklaceCanvas) {
          ctx.drawImage(occludedNecklaceCanvas, 0, 0);
        } else {
          drawJewelleryOverlay(ctx, overlay.image, overlay.transform, overlay.opacity, overlay.strips, overlay.horizontalForeshorten);
        }
      });
      const t3 = performance.now();

      // M6.6 spec Step 12 ("Comparison mode"): draws the M6.5-equivalent (yaw forced
      // to 0) necklace rendering into a SEPARATE canvas, from the SAME video frame and
      // the SAME already-tracked transform/image as the main canvas just used above --
      // never a second tracking pass, never altered placement. Dev/debug-only, gated
      // behind showWearComparisonRef exactly like the other debug canvases.
      if (showWearComparisonRef.current && category === "necklace" && loaded?.attachmentModel) {
        const necklaceOverlay = overlays[0] ?? null;
        const comparisonCanvas = wearComparisonCanvasRef.current;
        if (necklaceOverlay && comparisonCanvas) {
          ensureCanvasSize(comparisonCanvas, videoWidthPx, videoHeightPx);
          const comparisonCtx = comparisonCanvas.getContext("2d");
          if (comparisonCtx) {
            const legacyDeformation = computeJewelleryStrips(loaded.geometry, loaded.attachmentModel.curvature, 0);
            renderLiveFrame(comparisonCtx, { video, videoWidthPx, videoHeightPx }, {
              image: necklaceOverlay.image,
              transform: necklaceOverlay.transform,
              opacity: necklaceOverlay.opacity,
              strips: legacyDeformation.strips,
              horizontalForeshorten: legacyDeformation.horizontalForeshorten,
            });
          }
        }
      }

      // Debug overlay: uses the SAME actually-rendered (post-smoothing) transform just
      // drawn above, on the SAME live frame -- never a re-derivation, so this can't
      // silently drift from what the person is actually seeing on screen.
      if (debugEnabledRef.current && category === "necklace" && loaded) {
        const necklaceOverlay = overlays[0] ?? null;
        // M6.6: the wear-geometry markers (neck boundaries/contact curve) are folded
        // into this SAME existing debug overlay rather than a second toggle -- see
        // debug.ts's WearGeometryDebugInput doc comment. Null when there's no necklace
        // overlay this frame (tracking lost), same condition every other field here
        // already handles.
        const wearDebug = necklaceOverlay
          ? {
              strips: necklaceOverlay.strips,
              horizontalForeshorten: necklaceOverlay.horizontalForeshorten,
              contactPeakFraction: necklaceOverlay.contactPeakFraction,
              yawAsymmetry,
            }
          : null;
        const snapshot = computeNecklaceDebugSnapshot(
          face,
          pose,
          videoWidthPx,
          videoHeightPx,
          loaded.geometry,
          necklaceOverlay?.transform ?? null,
          debugNeckFractionOverrideRef.current ?? undefined,
          debugNeckHorizontalOffsetOverrideRef.current ?? undefined,
          wearDebug
        );
        if (snapshot) {
          drawNecklaceDebugOverlay(ctx, snapshot);
          if (frameStartMs - lastDebugStateUpdateAtMsRef.current >= DEBUG_SNAPSHOT_STATE_THROTTLE_MS) {
            lastDebugStateUpdateAtMsRef.current = frameStartMs;
            setDebugSnapshot(snapshot);
          }
        }
        // Phase G Step 15: the real parametric neck surface (computed earlier this
        // frame, using the SAME runtime.camera the jewellery was actually rendered
        // with), drawn on top of the same debug overlay -- this is what makes "why
        // does the jewellery float" answerable by looking at the frame, not just
        // reading numbers.
        if (neckSurfaceDebugPoints) {
          drawNeckSurfaceDebugOverlay(
            ctx,
            neckSurfaceDebugPoints.outlinePx,
            neckSurfaceDebugPoints.frontPx,
            neckSurfaceDebugPoints.normalEndPx,
            neckSurfaceDebugPoints.attachmentPx
          );
        }
      }

      // M6.3 debug-only mask visualization: drawn AFTER the jewellery, using whatever
      // the cadence scheduler currently holds (a fresh mask from this frame, or a
      // stale one from an earlier frame -- Step 14's "stale-mask reuse"). Fully gated
      // behind showSegmentationDebugRef -- when false, none of this runs, and the
      // canvas is byte-for-byte what it was before M6.3 (Step 20).
      if (showSegmentationDebugRef.current) {
        const latestMask = segmentationSchedulerRef.current.getLatest();
        if (latestMask) {
          if (!segmentationDebugCanvasRef.current) segmentationDebugCanvasRef.current = document.createElement("canvas");
          const maskCanvas = segmentationDebugCanvasRef.current;
          if (maskCanvas.width !== latestMask.maskWidthPx || maskCanvas.height !== latestMask.maskHeightPx) {
            maskCanvas.width = latestMask.maskWidthPx;
            maskCanvas.height = latestMask.maskHeightPx;
          }
          const maskCtx = maskCanvas.getContext("2d");
          if (maskCtx) {
            const rgba = buildSegmentationDebugRgba(latestMask.categoryData, latestMask.maskWidthPx, latestMask.maskHeightPx);
            // TS's DOM lib types ImageData's constructor as wanting a Uint8ClampedArray
            // backed specifically by ArrayBuffer (not the broader ArrayBufferLike a
            // freshly-constructed typed array is inferred as) -- a typing-only mismatch,
            // never a real SharedArrayBuffer here, so the cast is safe.
            maskCtx.putImageData(
              new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, latestMask.maskWidthPx, latestMask.maskHeightPx),
              0,
              0
            );
            drawSegmentationDebugOverlay(ctx, maskCanvas, latestMask.maskWidthPx, latestMask.maskHeightPx, videoWidthPx, videoHeightPx);
          }
        }
      }

      // M6.4 debug-only visualization (Step 15/16): the FINAL occlusion decision for
      // the current necklace (distinct from the raw segmentation categories drawn
      // above) -- only populated this frame when occlusion actually ran. Drawn in the
      // same unmirrored space as everything else, no independent mirroring added.
      if (showOcclusionDebugRef.current && occlusionDebugCanvasRef.current && occludedNecklaceCanvas) {
        const debugCanvas = occlusionDebugCanvasRef.current;
        drawSegmentationDebugOverlay(ctx, debugCanvas, debugCanvas.width, debugCanvas.height, videoWidthPx, videoHeightPx);
      }

      const totalFrameMs = previousFrameAtMs === null ? t3 - t0 : frameStartMs - previousFrameAtMs;
      performanceTrackerRef.current.record({
        totalFrameMs,
        trackingMs: t1 - t0,
        geometryMs: t2 - t1,
        renderMs: t3 - t2Render,
        droppedFrame: totalFrameMs > DROPPED_FRAME_THRESHOLD_MS,
        segmentationMs,
        occlusionMs,
        alphaMaskMs,
        faceDetectMs,
        poseDetectMs,
        deformationMs,
      });

      setTrackingStatus(primaryStatus);
      setPerformanceSnapshot(performanceTrackerRef.current.snapshot());
      setReadiness(
        category === "necklace"
          ? evaluateNecklaceReadiness(pose, videoWidthPx, videoHeightPx)
          : evaluateEarringsReadiness("left", face, videoWidthPx, videoHeightPx)
      );
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [category, necklaceLength, jewelleryId]);

  const captureFrame = useCallback((): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return Promise.resolve(null);
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92));
  }, []);

  return {
    videoRef,
    canvasRef,
    // Live AR mirrors the preview for a natural "looking in a mirror" UX -- see
    // coordinates.ts's module docstring for why this is safe (mirroring the shared
    // wrapper only, never individual tracking/render coordinates).
    mirrorTransform: containerMirrorTransform(true),
    cameraStatus,
    cameraError,
    trackersStatus,
    trackersError,
    assetLoading,
    assetError,
    trackingStatus,
    readiness,
    performance: performanceSnapshot,
    debugSnapshot,
    segmentationStatus,
    segmentationError,
    occlusionDebugInfo,
    live3dDebugInfo,
    finalVisibilityMaskCanvasRef,
    jewelleryAlphaDebugCanvasRef,
    wearComparisonCanvasRef,
    captureFrame,
  };
}
