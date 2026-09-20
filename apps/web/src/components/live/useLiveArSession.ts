"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AssetWithPreviewResponse } from "@/lib/catalogue-types";
import { loadJewelleryAssetTexture } from "@/lib/live-ar/asset-cache";
import { startLiveCamera, stopLiveCamera, type CameraError } from "@/lib/live-ar/camera";
import { containerMirrorTransform } from "@/lib/live-ar/coordinates";
import { computeNecklaceDebugSnapshot, type NecklaceDebugSnapshot } from "@/lib/live-ar/debug";
import { planCategoryRenders } from "@/lib/live-ar/geometry";
import { NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH } from "@/lib/live-ar/constants";
import { PerformanceTracker, type PerformanceSnapshot } from "@/lib/live-ar/performance";
import { evaluateEarringsReadiness, evaluateNecklaceReadiness, type ReadinessResult } from "@/lib/live-ar/readiness";
import { drawJewelleryOverlay, drawNecklaceDebugOverlay, ensureCanvasSize, renderLiveFrame } from "@/lib/live-ar/renderer";
import { TransformSmoother } from "@/lib/live-ar/smoothing";
import { createLiveTrackers, detectFrame, type LiveTrackers } from "@/lib/live-ar/tracking";
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
}: UseLiveArSessionArgs): UseLiveArSessionResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackersRef = useRef<LiveTrackers | null>(null);
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
  const lastDebugStateUpdateAtMsRef = useRef<number>(0);
  const debugEnabledRef = useRef(debugEnabled);
  debugEnabledRef.current = debugEnabled;
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
      const { face, pose } = detectFrame(trackers, video, nowMs);
      const t1 = performance.now();

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

      renderLiveFrame(ctx, { video, videoWidthPx, videoHeightPx }, null);
      for (const overlay of overlays) {
        drawJewelleryOverlay(ctx, overlay.image, overlay.transform, overlay.opacity);
      }
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

      const totalFrameMs = previousFrameAtMs === null ? t3 - t0 : frameStartMs - previousFrameAtMs;
      performanceTrackerRef.current.record({
        totalFrameMs,
        trackingMs: t1 - t0,
        geometryMs: t2 - t1,
        renderMs: t3 - t2,
        droppedFrame: totalFrameMs > DROPPED_FRAME_THRESHOLD_MS,
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
    captureFrame,
  };
}
