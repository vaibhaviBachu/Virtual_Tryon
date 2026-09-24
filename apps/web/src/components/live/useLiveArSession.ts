"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AssetWithPreviewResponse } from "@/lib/catalogue-types";
import { loadJewelleryAssetTexture } from "@/lib/live-ar/asset-cache";
import { startLiveCamera, stopLiveCamera, type CameraError } from "@/lib/live-ar/camera";
import { containerMirrorTransform } from "@/lib/live-ar/coordinates";
import { computeNecklaceDebugSnapshot, type NecklaceDebugSnapshot } from "@/lib/live-ar/debug";
import { computeTransformedBoundingBox, planCategoryRenders } from "@/lib/live-ar/geometry";
import {
  NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH,
  OCCLUSION_STALE_MASK_THRESHOLD_MS,
  SEGMENTATION_INTERVAL_MS_DEFAULT,
} from "@/lib/live-ar/constants";
import {
  buildFinalVisibilityMaskRgba,
  buildOcclusionDebugRgba,
  buildOcclusionEraseRgba,
  computeCategoryDistribution,
  computeHairOverlapReport,
  computeNecklaceOcclusionMask,
  isMaskStale,
  toMaskSpaceRegion,
  type CategoryDistribution,
  type HairOverlapReport,
} from "@/lib/live-ar/occlusion";
import { PerformanceTracker, type PerformanceSnapshot } from "@/lib/live-ar/performance";
import { evaluateEarringsReadiness, evaluateNecklaceReadiness, type ReadinessResult } from "@/lib/live-ar/readiness";
import {
  drawJewelleryOverlay,
  drawNecklaceDebugOverlay,
  drawOccludedJewelleryOverlay,
  drawSegmentationDebugOverlay,
  ensureCanvasSize,
  renderLiveFrame,
} from "@/lib/live-ar/renderer";
import { buildSegmentationDebugRgba, createLiveSegmenter, runSegmentation, SegmentationCadenceScheduler, type LiveSegmenter } from "@/lib/live-ar/segmentation";
import { TransformSmoother } from "@/lib/live-ar/smoothing";
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

export interface UseLiveArSessionArgs {
  category: CategorySlug;
  jewelleryId: string | null;
  asset: AssetWithPreviewResponse | null;
  necklaceLength?: string | null;
  /** Necklace-mode-only: further neck items worn AT THE SAME TIME as `asset` above
   * (e.g. a haaram layered under a necklace) -- see LiveArStudio's multi-select
   * "Choose pieces to layer" panel. Each is rendered with its own independent
   * tracking/smoothing state, progressively nudged further down the neck than the
   * previous one (constants.ts's NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH) so
   * simultaneously worn items land at visibly different depths. Empty/omitted outside
   * necklace mode -- unchanged single-item behavior. */
  additionalNecklaceItems?: { jewelleryId: string; asset: AssetWithPreviewResponse | null }[];
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
  additionalNecklaceItems = [],
  debugEnabled = false,
  debugNeckFractionOverride = null,
  debugNeckHorizontalOffsetOverride = null,
  showSegmentationDebug = false,
  showOcclusionDebug = false,
}: UseLiveArSessionArgs): UseLiveArSessionResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // M6.4 real-device review Step 2 -- rendered by the CALLER as a real <canvas>
  // element (same externally-owned pattern as canvasRef above), so the render loop
  // below draws into it only once it's actually mounted (null-checked, same as
  // videoRef/canvasRef already are).
  const finalVisibilityMaskCanvasRef = useRef<HTMLCanvasElement>(null);
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
  const assetGeometryRef = useRef<{ image: HTMLImageElement; geometry: JewelleryAssetGeometry } | null>(null);
  // Keyed by jewelleryId -- one loaded texture per additionally-layered neck item. Read
  // fresh every frame inside the render loop (never restarts it), updated by the
  // separate effect below whenever the selected set/preview URLs actually change.
  const additionalGeometryRef = useRef<Map<string, { image: HTMLImageElement; geometry: JewelleryAssetGeometry }>>(new Map());
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
    loadJewelleryAssetTexture(asset, asset.preview_url)
      .then((loaded) => {
        if (cancelled) return;
        assetGeometryRef.current = loaded;
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
  }, [asset]);

  // Same texture-loading pattern as the primary asset above, for each additionally
  // layered item. Keyed on a stable string derived from (id, preview_url) pairs rather
  // than the array itself, since the caller passes a freshly-built array every render.
  const additionalItemsKey = additionalNecklaceItems.map((item) => `${item.jewelleryId}:${item.asset?.preview_url ?? ""}`).join("|");
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
      loadJewelleryAssetTexture(item.asset, item.asset.preview_url)
        .then((loaded) => {
          if (cancelled) return;
          additionalGeometryRef.current.set(item.jewelleryId, loaded);
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
      let overlays: { image: HTMLImageElement; transform: LiveTransform; opacity: number }[] = [];
      let primaryStatus: TrackingStatus = "TRACKING_LOST";

      if (loaded) {
        const plans = planCategoryRenders(
          category,
          loaded.geometry,
          face,
          pose,
          videoWidthPx,
          videoHeightPx,
          necklaceLength,
          debugNeckFractionOverrideRef.current ?? undefined,
          debugNeckHorizontalOffsetOverrideRef.current ?? undefined
        );
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
          return [{ image: loaded.image, transform: result.transform, opacity: result.opacity }];
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
            necklaceLength,
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
          overlays.push({ image: additionalLoaded.image, transform: result.transform, opacity: result.opacity });
        });
      }
      const t2 = performance.now();

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
      let occlusionMs: number | null = null;
      let occludedNecklaceCanvas: HTMLCanvasElement | null = null;
      if (category === "necklace" && loaded && overlays.length > 0) {
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

        // Step 13: a stale or missing mask falls back to NO occlusion (the necklace
        // draws exactly as it did before M6.4) rather than trusting old data or
        // hiding the necklace outright.
        if (!stale && latestMask && region) {
          const occStart = performance.now();
          const occlusionMask = computeNecklaceOcclusionMask(
            latestMask.categoryData,
            latestMask.maskWidthPx,
            latestMask.maskHeightPx,
            region
          );
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
              videoHeightPx
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
        // The primary necklace overlay is drawn from the occlusion-composited
        // offscreen canvas when occlusion actually ran this frame; every other
        // overlay (earrings, additional layered neck items, or the necklace itself
        // when occlusion did NOT run) draws exactly as it did before M6.4.
        if (index === 0 && occludedNecklaceCanvas) {
          ctx.drawImage(occludedNecklaceCanvas, 0, 0);
        } else {
          drawJewelleryOverlay(ctx, overlay.image, overlay.transform, overlay.opacity);
        }
      });
      const t3 = performance.now();

      // Debug overlay: uses the SAME actually-rendered (post-smoothing) transform just
      // drawn above, on the SAME live frame -- never a re-derivation, so this can't
      // silently drift from what the person is actually seeing on screen.
      if (debugEnabledRef.current && category === "necklace" && loaded) {
        const necklaceOverlay = overlays[0] ?? null;
        const snapshot = computeNecklaceDebugSnapshot(
          face,
          pose,
          videoWidthPx,
          videoHeightPx,
          loaded.geometry,
          necklaceOverlay?.transform ?? null,
          debugNeckFractionOverrideRef.current ?? undefined,
          debugNeckHorizontalOffsetOverrideRef.current ?? undefined
        );
        if (snapshot) {
          drawNecklaceDebugOverlay(ctx, snapshot);
          if (frameStartMs - lastDebugStateUpdateAtMsRef.current >= DEBUG_SNAPSHOT_STATE_THROTTLE_MS) {
            lastDebugStateUpdateAtMsRef.current = frameStartMs;
            setDebugSnapshot(snapshot);
          }
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
        faceDetectMs,
        poseDetectMs,
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
    finalVisibilityMaskCanvasRef,
    captureFrame,
  };
}
