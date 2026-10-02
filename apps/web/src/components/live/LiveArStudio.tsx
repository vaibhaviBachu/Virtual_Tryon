"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAsset, listAssets, listCategories, listJewellery } from "@/lib/catalogue-api";
import { createLiveArCapture } from "@/lib/live-ar-api";
import { formatLive3dDebugInfo, formatNecklaceDebugSnapshot } from "@/lib/live-ar/debug";
import { formatCategoryDistribution, formatHairOverlapReport, formatJewelleryAlphaOcclusionReport } from "@/lib/live-ar/occlusion";
import { NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH } from "@/lib/live-ar/constants";
import {
  clearSavedNeckFractionOverride,
  readSavedNeckFractionOverride,
  saveNeckFractionOverride,
} from "@/lib/live-ar/neck-fraction-override";
import {
  clearSavedNeckHorizontalOffsetOverride,
  readSavedNeckHorizontalOffsetOverride,
  saveNeckHorizontalOffsetOverride,
} from "@/lib/live-ar/neck-horizontal-offset-override";
import {
  formatDeformationDebugText,
  formatOcclusionDebugText,
  formatPerformanceOverlayText,
  formatSegmentationDebugText,
  formatTrackingBreakdownText,
} from "@/lib/live-ar/performance";
import { createTryOnSession } from "@/lib/tryon-api";
import type { CategorySlug } from "@/lib/live-ar/types";
import { cn } from "@/lib/utils";
import { useLiveArSession } from "@/components/live/useLiveArSession";
import { BotPreview } from "@/components/live/BotPreview";
import { JewelleryTile } from "@/components/live/JewelleryTile";
import { HeroIntro } from "@/components/live/HeroIntro";

const TRACKING_STATUS_LABEL: Record<string, string> = {
  TRACKING_GOOD: "Tracking",
  TRACKING_DEGRADED: "Holding position",
  TRACKING_LOST: "Move into frame",
};

/**
 * "Live AR Try-On Studio" -- the Milestone 5 UI, deliberately a SEPARATE page/component
 * tree from the existing photo Try-On Studio (app/try-on/page.tsx), sharing only the
 * catalogue API and the underlying geometry/asset conventions, never a rendering loop
 * (spec §1, §2). Polished-retail-app framing per spec §22: camera + catalogue side by
 * side, lightweight contextual guidance, no dev-tool chrome by default (the performance
 * overlay is opt-in via a small toggle, not shown up front).
 */
// A person can layer at most this many neck items (e.g. a necklace + a haaram) at
// once. Purely a sanity cap on the UI/rendering, not a backend limit.
const MAX_SIMULTANEOUS_NECK_ITEMS = 3;

export function LiveArStudio() {
  const [category, setCategory] = useState<CategorySlug>("necklace");
  const [selectedJewelleryId, setSelectedJewelleryId] = useState<string | null>(null);
  // Necklace mode supports wearing multiple neck items at once (e.g. a short necklace
  // together with a long haaram) -- see docs/live-ar-architecture.md. Earrings mode
  // stays single-select via selectedJewelleryId above; this is necklace-only. Ordered:
  // the first entry is the "primary" item (reuses the existing single-asset plumbing
  // below), everything after it is layered further down the neck.
  const [selectedNecklaceIds, setSelectedNecklaceIds] = useState<string[]>([]);
  // Refines the necklace-mode grid to a real catalogue sub-slice -- "all" (the
  // existing default: necklace + haaram combined), or just one of those two real
  // category slugs. Deliberately NOT the mockup's full Choker/Temple/Layered/Pendant
  // tag set -- those aren't categories or any other classification this catalogue
  // actually has data for, so a pill for them would filter nothing (dishonest UI).
  const [necklaceFilter, setNecklaceFilter] = useState<"all" | "necklace" | "haaram" | "jewellery_set">("necklace");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showPerfOverlay, setShowPerfOverlay] = useState(false);
  // Necklace geometry debug mode (temporary diagnostic tooling -- see debug.ts):
  // draws face/shoulder/neck/jewellery attachment points on the live canvas and shows
  // their raw numeric values, so a real-camera placement question can be answered with
  // actual runtime numbers instead of a screenshot and a guess.
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  // M6.3 (docs/live-ar-realism-architecture.md §6/§7/§17): dev-only toggle for the
  // multiclass segmentation debug mask. Independent of showDebugOverlay above --
  // segmentation applies to every category, not just necklace, and this milestone is
  // explicitly a proof of concept, not a replacement for the necklace geometry panel.
  const [showSegmentationDebug, setShowSegmentationDebug] = useState(false);
  // M6.4 (docs/live-ar-realism-architecture.md §6/§7/§17): dev-only toggle for the
  // occlusion debug overlay (final per-pixel occlusion decision + mask-age/tracking
  // text readout). Independent of showSegmentationDebug above -- occlusion COMPOSITING
  // itself is always active for necklace whenever a fresh-enough mask exists,
  // regardless of this flag; this only controls whether you can SEE the decision.
  const [showOcclusionDebug, setShowOcclusionDebug] = useState(false);
  // M6.6 spec Step 12 ("Comparison mode"): dev-only toggle for the side-by-side
  // M6.5-equivalent (yaw-blind) vs. actual M6.6 rendering thumbnail. Independent of
  // showDebugOverlay above -- the wear-geometry MARKERS (neck boundaries/contact curve)
  // are folded into that existing necklace-debug overlay instead of a second toggle
  // (see debug.ts's WearGeometryDebugInput doc comment); this toggle is only for the
  // rendered-pixel A/B comparison.
  const [showWearComparison, setShowWearComparison] = useState(false);
  // Phase H.1 diagnostic (docs/2-5d-jewellery-surface-attachment.md's incident
  // follow-up) Step 5's explicit ask: "temporarily disable ALL occlusion... if the
  // rectangle disappears, the occlusion pipeline is the bug." Unlike
  // showOcclusionDebug above, this actually turns compositing off, not just its
  // visualization -- lets a real device test isolate the cause directly.
  const [disable3dOcclusionForDebug, setDisable3dOcclusionForDebug] = useState(false);
  // Persisted, per-browser calibration override (see neck-fraction-override.ts) -- the
  // automatic default from constants.ts is used unless/until someone saves a value from
  // the slider below, at which point it applies on every necklace session in THIS
  // browser, debug panel open or not, until cleared. Lazy-init from storage so the very
  // first render already reflects a previously saved value (no flash of the default).
  const [savedNeckFraction, setSavedNeckFraction] = useState<number | null>(() => readSavedNeckFractionOverride());
  // Live-tunable preview of the fraction while the slider is being dragged (see
  // neck-reference.ts's computeNeckReferenceFrame docstring). Dragging this changes the
  // ACTUAL rendered position in real time so the right value can be found against a real
  // camera without a rebuild per attempt. Starts from whatever's already saved (if
  // anything), so re-opening the panel picks up where you left off.
  const [neckFractionPreview, setNeckFractionPreview] = useState(
    () => readSavedNeckFractionOverride() ?? NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH
  );
  const [neckFractionSavedJustNow, setNeckFractionSavedJustNow] = useState(false);
  // Same pattern as the vertical (chin->shoulder) fraction above, for the necklace
  // anchor's horizontal position -- see neck-horizontal-offset-override.ts.
  const [savedNeckHorizontalOffset, setSavedNeckHorizontalOffset] = useState<number | null>(
    () => readSavedNeckHorizontalOffsetOverride()
  );
  const [neckHorizontalOffsetPreview, setNeckHorizontalOffsetPreview] = useState(
    () => readSavedNeckHorizontalOffsetOverride() ?? 0
  );
  const [neckHorizontalOffsetSavedJustNow, setNeckHorizontalOffsetSavedJustNow] = useState(false);
  const [captureState, setCaptureState] = useState<"idle" | "capturing" | "done" | "error">("idle");
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [captureErrorMessage, setCaptureErrorMessage] = useState<string | null>(null);
  // Catalogue-browse mode is the default landing experience (matching a real
  // competitor's category-dropdown + image-grid + "on the model" layout) -- the
  // camera/canvas DOM nodes and the live session hook stay mounted the whole time
  // either way (never torn down when toggling this), only the SURROUNDING
  // layout/chrome changes: fullscreen shows just the camera + a small back icon;
  // the catalogue view hides the live camera feed (kept mounted off-screen, not
  // unmounted) behind the category picker, image grid, and "on the model" preview.
  const [showPicker, setShowPicker] = useState(true);
  // Dev-only tooling (performance/segmentation/occlusion/wear-comparison overlays and
  // their toggle row) is hidden from the customer-facing page entirely by default --
  // spec: "these MUST NOT be visible on the normal customer-facing UI... but must
  // remain accessible through the appropriate development/debug mechanism." That
  // mechanism here is a `?debug=1` URL flag, checked once after mount (so the
  // server-rendered and first-client-render markup match, avoiding a hydration
  // mismatch) -- nothing is deleted, every debug feature still works exactly as
  // before once this is on.
  const [debugAllowed, setDebugAllowed] = useState(false);
  useEffect(() => {
    setDebugAllowed(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);
  // Temporary calibration tool for the "on the model" panel's position (lg+ only) --
  // same nudge-then-hardcode workflow used before for this same panel and the home
  // page background. Remove this state, the matchMedia effect below, and the arrow
  // box JSX once the final right/top values are confirmed and hardcoded back into
  // the panel's className.
  const [panelRightPx, setPanelRightPx] = useState(276);
  const [panelTopPx, setPanelTopPx] = useState(400);
  const [isLgUp, setIsLgUp] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const listener = (e: MediaQueryListEvent) => setIsLgUp(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    createTryOnSession({}).then((session) => setSessionId(session.id));
  }, []);

  const categoriesQuery = useQuery({ queryKey: ["live-ar-categories"], queryFn: () => listCategories(true) });
  const activeCategoryId = useMemo(
    () => categoriesQuery.data?.find((c) => c.slug === category)?.id ?? null,
    [categoriesQuery.data, category]
  );
  // Haaram (a long traditional necklace) is a separate catalogue category from
  // "necklace", but shares the same neck anchor -- necklace mode's picker offers both
  // together so a short necklace and a long haaram can be worn at the same time.
  const haaramCategoryId = useMemo(
    () => categoriesQuery.data?.find((c) => c.slug === "haaram")?.id ?? null,
    [categoriesQuery.data]
  );
  // Jewellery Set items are catalogued as a full look (necklace + earrings + ...), but
  // this catalogue only has ONE photo per item, so -- same as Haaram above -- it's
  // worn via the plain necklace attachment point, not a real multi-piece anchor.
  // Anything added under this category in admin shows up here automatically, same as
  // every other merged category.
  const jewellerySetCategoryId = useMemo(
    () => categoriesQuery.data?.find((c) => c.slug === "jewellery_set")?.id ?? null,
    [categoriesQuery.data]
  );

  const jewelleryQuery = useQuery({
    queryKey: ["live-ar-jewellery", activeCategoryId],
    queryFn: () => listJewellery({ categoryId: activeCategoryId ?? undefined, page: 1, pageSize: 24 }),
    enabled: activeCategoryId !== null,
  });
  const haaramItemsQuery = useQuery({
    queryKey: ["live-ar-jewellery", haaramCategoryId],
    queryFn: () => listJewellery({ categoryId: haaramCategoryId ?? undefined, page: 1, pageSize: 24 }),
    enabled: category === "necklace" && haaramCategoryId !== null,
  });
  const jewellerySetItemsQuery = useQuery({
    queryKey: ["live-ar-jewellery", jewellerySetCategoryId],
    queryFn: () => listJewellery({ categoryId: jewellerySetCategoryId ?? undefined, page: 1, pageSize: 24 }),
    enabled: category === "necklace" && jewellerySetCategoryId !== null,
  });
  // Necklace mode's full pickable list: plain necklace items plus haaram plus
  // jewellery-set items, combined -- see selectedNecklaceIds above.
  const neckItems = useMemo(
    () =>
      category === "necklace"
        ? [
            ...(jewelleryQuery.data?.items ?? []),
            ...(haaramItemsQuery.data?.items ?? []),
            ...(jewellerySetItemsQuery.data?.items ?? []),
          ]
        : [],
    [category, jewelleryQuery.data, haaramItemsQuery.data, jewellerySetItemsQuery.data]
  );
  // The grid's actual visible list -- neckItems filtered down to the active pill (see
  // necklaceFilter above). Selection/layering still operates over the full neckItems
  // list elsewhere (an already-selected item stays worn even if a filter hides its tile).
  const visibleNeckItems = useMemo(
    () => (necklaceFilter === "all" ? neckItems : neckItems.filter((item) => item.category.slug === necklaceFilter)),
    [neckItems, necklaceFilter]
  );

  // Switching jewellery never restarts the camera or reloads the page (spec §12/§20):
  // this just changes which cached texture the render loop reads. Earrings stays
  // single-select, auto-picking the first item whenever the current selection isn't
  // (or is no longer) in the list.
  useEffect(() => {
    if (category !== "earrings") return;
    const items = jewelleryQuery.data?.items;
    if (items && items.length > 0 && !items.some((item) => item.id === selectedJewelleryId)) {
      setSelectedJewelleryId(items[0].id);
    }
  }, [category, jewelleryQuery.data, selectedJewelleryId]);

  // Necklace mode only auto-picks a first item when nothing is selected yet -- unlike
  // earrings, it must never clobber a deliberate multi-selection when the list refetches.
  useEffect(() => {
    if (category !== "necklace" || selectedNecklaceIds.length > 0 || neckItems.length === 0) return;
    setSelectedNecklaceIds([neckItems[0].id]);
  }, [category, neckItems, selectedNecklaceIds.length]);

  function toggleNecklaceItem(id: string) {
    setSelectedNecklaceIds((prev) => {
      if (prev.includes(id)) return prev.filter((existing) => existing !== id);
      if (prev.length >= MAX_SIMULTANEOUS_NECK_ITEMS) return prev;
      return [...prev, id];
    });
  }

  // The "primary" selected item (earrings' single selection, or necklace mode's first
  // pick) keeps using the original single-asset plumbing below -- everything after it
  // in selectedNecklaceIds is "additional", loaded and rendered separately (see
  // useLiveArSession's necklaceItems handling).
  const primaryId = category === "necklace" ? selectedNecklaceIds[0] ?? null : selectedJewelleryId;
  const additionalNeckIds = category === "necklace" ? selectedNecklaceIds.slice(1) : [];

  const assetsQuery = useQuery({
    queryKey: ["live-ar-assets", primaryId],
    queryFn: () => listAssets(primaryId!),
    enabled: primaryId !== null,
  });
  const processedAssetSummary = assetsQuery.data?.find((a) => a.asset_type === "processed" && a.processing_status === "ready");

  const assetWithPreviewQuery = useQuery({
    queryKey: ["live-ar-asset-preview", processedAssetSummary?.id],
    queryFn: () => getAsset(processedAssetSummary!.id),
    enabled: !!processedAssetSummary,
  });

  // Same two-step (list assets -> fetch the ready "processed" one) resolution as the
  // primary item above, but for each additional layered item -- useQueries (rather
  // than calling useQuery in a loop, which the rules of hooks forbid) is React Query's
  // own supported pattern for a dynamically-sized list of queries.
  const additionalAssetsListQueries = useQueries({
    queries: additionalNeckIds.map((id) => ({
      queryKey: ["live-ar-assets", id],
      queryFn: () => listAssets(id),
    })),
  });
  const additionalAssetQueries = useQueries({
    queries: additionalNeckIds.map((id, index) => {
      const processedId = additionalAssetsListQueries[index]?.data?.find(
        (a) => a.asset_type === "processed" && a.processing_status === "ready"
      )?.id;
      return {
        queryKey: ["live-ar-asset-preview", processedId ?? null],
        queryFn: () => getAsset(processedId!),
        enabled: processedId !== undefined,
      };
    }),
  });
  // M6.5 (jewellery-attachment.ts): each item's OWN catalogue category slug + physical
  // width feed its attachment class (choker/necklace/haaram) and scale -- sourced from
  // whichever list actually holds the full JewelleryResponse for that id (neckItems for
  // necklace mode, jewelleryQuery's own list for earrings).
  const primaryJewelleryItem =
    (category === "necklace" ? neckItems : jewelleryQuery.data?.items ?? []).find((item) => item.id === primaryId) ?? null;
  const additionalNecklaceItems = additionalNeckIds.map((id, index) => {
    const item = neckItems.find((neckItem) => neckItem.id === id) ?? null;
    return {
      jewelleryId: id,
      asset: additionalAssetQueries[index]?.data ?? null,
      categorySlug: item?.category.slug ?? null,
      physicalWidthMm: item?.physical_width_mm ?? null,
    };
  });

  const session = useLiveArSession({
    category,
    jewelleryId: primaryId,
    asset: assetWithPreviewQuery.data ?? null,
    primaryCategorySlug: primaryJewelleryItem?.category.slug ?? null,
    primaryPhysicalWidthMm: primaryJewelleryItem?.physical_width_mm ?? null,
    additionalNecklaceItems: category === "necklace" ? additionalNecklaceItems : [],
    debugEnabled: showDebugOverlay,
    // Always the live preview value (which itself starts from whatever's saved for
    // this browser, or the automatic default) -- so the arrow/drag calibration box
    // below updates the ACTUAL live camera in real time, not just while the dev debug
    // panel happens to be open. This is what makes "drag it, click Save" stick for
    // ordinary use.
    debugNeckFractionOverride: category === "necklace" ? neckFractionPreview : null,
    debugNeckHorizontalOffsetOverride: category === "necklace" ? neckHorizontalOffsetPreview : null,
    showSegmentationDebug,
    showOcclusionDebug,
    showWearComparison,
    disable3dOcclusionForDebug,
  });

  async function handleCapture() {
    if (!sessionId || !primaryId) return;
    setCaptureState("capturing");
    setCaptureErrorMessage(null);
    try {
      const blob = await session.captureFrame();
      if (!blob) throw new Error("The camera isn't ready yet.");
      // Capture-and-save persists a single result image -- multi-item layering is a
      // live-preview-only feature for now, so this always saves against the primary
      // (first-selected) item, same as before this feature existed.
      const capture = await createLiveArCapture(sessionId, primaryId, processedAssetSummary?.id ?? null, blob);
      setCaptureUrl(capture.result_url);
      setCaptureState("done");
    } catch (err) {
      setCaptureErrorMessage(err instanceof Error ? err.message : "Couldn't save your capture.");
      setCaptureState("error");
    }
  }

  const cameraBlocked = session.cameraStatus === "error";
  const isLoadingPipeline = session.cameraStatus !== "ready" || session.trackersStatus !== "ready";
  const maskCapturedAtMs = session.occlusionDebugInfo?.maskCapturedAtMs ?? null;

  return (
    <div className={showPicker ? "mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-8 pt-6 sm:px-6 lg:flex-row lg:items-start lg:px-8" : ""}>
      {/* The live camera/canvas stay mounted the whole time regardless of showPicker
          (never torn down when toggling) -- in catalogue mode this wrapper is
          visually clipped to nothing (sr-only) rather than unmounted, so the
          session never restarts; in full-screen mode it's a plain passthrough so
          the Card's own fixed-position classes below take over the whole viewport. */}
      <div className={showPicker ? "sr-only" : "contents"}>
        <Card className={cn("overflow-hidden", !showPicker && "fixed inset-0 z-40 rounded-none border-0")}>
          <div className={cn("relative w-full bg-neutral-950", showPicker ? "aspect-[4/3]" : "h-screen")}>
            {/* The full-screen camera experience's own back affordance -- the ONLY
                way there besides the catalogue layout below. Never tears down the
                camera/session; only this surrounding layout toggles. */}
            {!showPicker && (
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                aria-label="Back to pick jewellery"
                className="absolute left-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}

            {cameraBlocked ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-neutral-300">
                <p>{session.cameraError?.message ?? "The camera is unavailable."}</p>
              </div>
            ) : (
              <div className="relative h-full w-full" style={{ transform: session.mirrorTransform }}>
                <video ref={session.videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                <canvas ref={session.canvasRef} className="absolute inset-0 h-full w-full object-cover" />
              </div>
            )}

            {/* The one customer-facing action that must survive in BOTH layouts --
                floating here (never inside the picker-only CardContent below) so it's
                never lost when full-screen. */}
            {!isLoadingPipeline && !cameraBlocked && (
              <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
                {captureState === "done" && captureUrl && (
                  <a
                    href={captureUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-black/60 px-3 py-1 text-xs text-white underline underline-offset-2"
                  >
                    Saved -- view your capture
                  </a>
                )}
                {captureState === "error" && captureErrorMessage && (
                  <p className="max-w-[220px] rounded-full bg-black/60 px-3 py-1 text-right text-xs text-red-300">{captureErrorMessage}</p>
                )}
                <Button onClick={handleCapture} disabled={captureState === "capturing"}>
                  {captureState === "capturing" ? "Saving…" : "Capture"}
                </Button>
              </div>
            )}

            {isLoadingPipeline && !cameraBlocked && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
                {session.trackersStatus === "error"
                  ? (session.trackersError ?? "Live tracking is unavailable in this browser.")
                  : "Starting your camera…"}
              </div>
            )}

            {!isLoadingPipeline && session.readiness?.guidance && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white">
                {session.readiness.guidance}
              </div>
            )}

            {!isLoadingPipeline && (
              <div className="absolute right-3 top-3 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white">
                {TRACKING_STATUS_LABEL[session.trackingStatus]}
              </div>
            )}


            {debugAllowed && showPerfOverlay && (
              <div className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-lime-300">
                <div>{formatPerformanceOverlayText(session.performance)}</div>
                {/* 2026-09-24 real-device review Step 12: split "Tracking" into its
                    real FaceLandmarker/PoseLandmarker components. */}
                <div>{formatTrackingBreakdownText(session.performance)}</div>
                {/* M6.6 spec Step 14: real, measured cost of the yaw-responsive strip
                    recomputation -- a subset of "Geometry" above, not additional to it. */}
                <div>{formatDeformationDebugText(session.performance)}</div>
              </div>
            )}

            {/* M6.3 proof of concept -- real inference timing for real-device
                verification (docs/live-ar-realism-verification.md's M6.3 section),
                never estimated. Dev-only, never part of the customer experience. */}
            {showSegmentationDebug && (
              <div className="absolute left-3 bottom-3 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-cyan-300">
                {formatSegmentationDebugText(session.segmentationStatus, session.segmentationError, session.performance.segmentation)}
              </div>
            )}

            {/* M6.4 proof of concept -- real occlusion compositing timing and mask-age
                state for real-device verification, never estimated. Dev-only, never
                part of the customer experience. */}
            {showOcclusionDebug && (
              <div className="absolute right-3 bottom-3 max-w-[70%] rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-rose-300">
                <div>{formatOcclusionDebugText(session.occlusionDebugInfo, session.performance.occlusion)}</div>
                {session.occlusionDebugInfo?.distribution && (
                  <div>{formatCategoryDistribution(session.occlusionDebugInfo.distribution)}</div>
                )}
                {/* 2026-09-24 controlled real-device validation Step 4 -- the primary
                    acceptance-test readout: whether hair actually overlaps the
                    necklace's own region right now, from real pixels. */}
                {session.occlusionDebugInfo?.hairOverlap && (
                  <div className="font-bold">{formatHairOverlapReport(session.occlusionDebugInfo.hairOverlap)}</div>
                )}
                {/* 2026-09-24, round 2 -- the corrected metrics: bounding-box hair%
                    (the OLD, misleading number) shown side by side with hair/clothes
                    overlap against the jewellery's ACTUAL alpha footprint (the fix). */}
                {session.occlusionDebugInfo?.distribution && session.occlusionDebugInfo?.alphaOcclusionReport && (
                  <div className="font-bold text-amber-300">
                    {formatJewelleryAlphaOcclusionReport(
                      session.occlusionDebugInfo.distribution.hairPct,
                      session.occlusionDebugInfo.alphaOcclusionReport
                    )}
                  </div>
                )}
                {maskCapturedAtMs !== null && (
                  <div>Segmentation timestamp: {maskCapturedAtMs.toFixed(0)}ms (session-relative)</div>
                )}
              </div>
            )}

            {/* 2026-09-24 real-device review Step 2: standalone white/black final
                visibility mask -- a picture-in-picture panel, deliberately NOT
                composited onto the camera feed (see finalVisibilityMaskCanvasRef's own
                doc comment for why). White = jewellery visible, black = occluded. */}
            {showOcclusionDebug && (
              <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
                <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                  Final visibility (white=shown, black=hidden)
                </span>
                <canvas
                  ref={session.finalVisibilityMaskCanvasRef}
                  className="h-24 w-24 rounded border border-white/40 bg-black/40 [image-rendering:pixelated]"
                />
              </div>
            )}

            {/* 2026-09-24 controlled real-device validation Step 9/10: standalone
                green/red/blue/black jewellery-alpha diagnostic -- GREEN=jewellery
                visible, RED=hair-over-jewellery, BLUE=clothing-over-jewellery (above
                the attachment line), BLACK=no jewellery there. Built from the exact
                masks the compositor used, never a separate/fake visualization. */}
            {showOcclusionDebug && (
              <div className="absolute right-3 top-32 flex flex-col items-end gap-1">
                <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                  Jewellery alpha (green=visible, red=hair, blue=clothes, black=none)
                </span>
                <canvas
                  ref={session.jewelleryAlphaDebugCanvasRef}
                  className="h-24 w-24 rounded border border-white/40 bg-black/40 [image-rendering:pixelated]"
                />
              </div>
            )}

            {/* M6.6 spec Step 12 -- side-by-side comparison: this panel shows the
                M6.5-equivalent (yaw-blind, angle-independent) rendering, from the SAME
                camera frame and jewellery the main canvas (M6.6, yaw-responsive) just
                drew above -- dev/debug-only, never part of the customer experience. */}
            {showWearComparison && (
              <div className="absolute bottom-3 left-3 flex flex-col items-start gap-1">
                <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">M6.5-equivalent (yaw-blind) comparison</span>
                <canvas ref={session.wearComparisonCanvasRef} className="h-28 w-36 rounded border border-white/40 bg-black/40 object-cover" />
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* lg:pr reserves the same width the now lg:absolute model panel occupies (420px +
          its 96px/right-24 offset from the viewport edge + a gap), since `fixed`
          removes it from this flex row entirely -- without this, the catalogue grid
          would spread under where the panel visually sits. */}
      <div className={showPicker ? "flex-1 lg:pr-[550px]" : "contents"}>
        {showPicker && (
          <>
            <HeroIntro />

            <div className="mb-4 flex flex-wrap gap-2 overflow-x-auto">
              {(
                [
                  { label: "Necklace", active: category === "necklace" && necklaceFilter === "necklace", onClick: () => { setCategory("necklace"); setNecklaceFilter("necklace"); } },
                  { label: "Haaram", active: category === "necklace" && necklaceFilter === "haaram", onClick: () => { setCategory("necklace"); setNecklaceFilter("haaram"); } },
                  { label: "Jewellery Set", active: category === "necklace" && necklaceFilter === "jewellery_set", onClick: () => { setCategory("necklace"); setNecklaceFilter("jewellery_set"); } },
                  { label: "All", active: category === "necklace" && necklaceFilter === "all", onClick: () => { setCategory("necklace"); setNecklaceFilter("all"); } },
                  { label: "Earrings", active: category === "earrings", onClick: () => setCategory("earrings") },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  onClick={pill.onClick}
                  className={cn(
                    "flex-none rounded-full px-4 py-2 text-base font-bold transition-colors",
                    pill.active ? "bg-[#C90016] text-white" : "bg-[#F8EEE5] text-neutral-700 hover:bg-[#F0E0D4]"
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {category === "necklace" && (
              <p className="mb-3 text-sm font-bold text-neutral-600">
                Tap a piece to preview it on the model, or tap the camera icon to try it on live -- pick more than
                one to layer them (e.g. a necklace and a haaram), up to {MAX_SIMULTANEOUS_NECK_ITEMS} at once.
              </p>
            )}

            {/* Fixed-height, internally-scrolling grid -- so a longer catalogue (6+
                items) scrolls ONLY the tiles, never the page itself. Before this, the
                whole page grew taller than the viewport and scrolled, which dragged
                the "on the model" panel (a normal flow sibling, self-stretch to match
                this column's height) along with it and made the layout feel like it
                was rearranging itself. */}
            <div className="max-h-[56vh] overflow-y-auto overscroll-contain pr-1">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {(category === "necklace" ? visibleNeckItems : jewelleryQuery.data?.items ?? []).map((item) => (
                  <JewelleryTile
                    key={item.id}
                    item={item}
                    isSelected={category === "necklace" ? selectedNecklaceIds.includes(item.id) : item.id === selectedJewelleryId}
                    onSelect={() => {
                      if (category === "necklace") toggleNecklaceItem(item.id);
                      else setSelectedJewelleryId(item.id);
                    }}
                    onTryOn={() => {
                      if (category === "necklace") {
                        setSelectedNecklaceIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
                      } else {
                        setSelectedJewelleryId(item.id);
                      }
                      setShowPicker(false);
                    }}
                  />
                ))}
                {(category === "necklace" ? visibleNeckItems.length === 0 : (jewelleryQuery.data?.items.length ?? 0) === 0) && (
                  <p className="col-span-full text-xs text-neutral-400">No items in this category yet.</p>
                )}
              </div>
            </div>

            {/* Dev-only tooling toggles -- never part of the customer experience
                (docs/live-ar-realism-architecture.md §6/§7/§17). Only reachable via
                ?debug=1 -- see debugAllowed above. */}
            {debugAllowed && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="text-xs text-neutral-400 underline-offset-2 hover:underline"
                onClick={() => setShowPerfOverlay((v) => !v)}
              >
                {showPerfOverlay ? "Hide" : "Show"} performance
              </button>
              {category === "necklace" && (
                <button
                  type="button"
                  className="text-xs text-neutral-400 underline-offset-2 hover:underline"
                  onClick={() => setShowDebugOverlay((v) => !v)}
                >
                  {showDebugOverlay ? "Hide" : "Show"} necklace debug
                </button>
              )}
              <button
                type="button"
                className="text-xs text-neutral-400 underline-offset-2 hover:underline"
                onClick={() => setShowSegmentationDebug((v) => !v)}
              >
                {showSegmentationDebug ? "Hide" : "Show"} segmentation debug
              </button>
              {category === "necklace" && (
                <button
                  type="button"
                  className="text-xs text-neutral-400 underline-offset-2 hover:underline"
                  onClick={() => setShowOcclusionDebug((v) => !v)}
                >
                  {showOcclusionDebug ? "Hide" : "Show"} occlusion debug
                </button>
              )}
              {category === "necklace" && (
                <button
                  type="button"
                  className="text-xs text-neutral-400 underline-offset-2 hover:underline"
                  onClick={() => setShowWearComparison((v) => !v)}
                >
                  {showWearComparison ? "Hide" : "Show"} wear comparison (M6.5 vs M6.6)
                </button>
              )}
              {category === "necklace" && (
                <button
                  type="button"
                  className="text-xs text-amber-400 underline-offset-2 hover:underline"
                  onClick={() => setDisable3dOcclusionForDebug((v) => !v)}
                >
                  {disable3dOcclusionForDebug ? "Re-enable" : "Disable"} 3D/2.5D occlusion (diagnostic)
                </button>
              )}
            </div>
            )}
          </>
        )}

        {showPicker && debugAllowed && showDebugOverlay && category === "necklace" && (
          <div className="mt-3 rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">
            <label className="flex items-center gap-3">
              <span className="whitespace-nowrap">
                Neck attachment fraction (chin&rarr;shoulder): <span className="font-mono text-lime-300">{neckFractionPreview.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={neckFractionPreview}
                onChange={(e) => {
                  setNeckFractionPreview(Number(e.target.value));
                  setNeckFractionSavedJustNow(false);
                }}
                className="flex-1"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={() => {
                  saveNeckFractionOverride(neckFractionPreview);
                  setSavedNeckFraction(neckFractionPreview);
                  setNeckFractionSavedJustNow(true);
                }}
              >
                Done -- fix at {neckFractionPreview.toFixed(2)}
              </Button>
              <button
                type="button"
                className="whitespace-nowrap text-neutral-400 underline-offset-2 hover:underline"
                onClick={() => {
                  setNeckFractionPreview(NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH);
                  setNeckFractionSavedJustNow(false);
                }}
              >
                Reset slider to automatic ({NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH.toFixed(2)})
              </button>
              {savedNeckFraction !== null && (
                <button
                  type="button"
                  className="whitespace-nowrap text-neutral-400 underline-offset-2 hover:underline"
                  onClick={() => {
                    clearSavedNeckFractionOverride();
                    setSavedNeckFraction(null);
                    setNeckFractionPreview(NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH);
                    setNeckFractionSavedJustNow(false);
                  }}
                >
                  Clear saved fix (go back to automatic)
                </button>
              )}
              {neckFractionSavedJustNow && <span className="text-lime-400">Saved -- this position is now fixed on this device.</span>}
              {!neckFractionSavedJustNow && savedNeckFraction !== null && (
                <span className="text-neutral-500">Currently fixed at {savedNeckFraction.toFixed(2)} on this device.</span>
              )}
            </div>
            <p className="mt-2 text-[10px] text-neutral-500">
              0 = right at the chin, 1 = right at the shoulder line. Dragging changes what you see live, on this
              frame, so you can find the right spot against your real camera. The automatic value (
              {NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH.toFixed(2)}) is used until you click Done -- once you do, that
              exact position is fixed for every necklace try-on in this browser, debug panel open or not, until you
              clear it.
            </p>
          </div>
        )}

        {showPicker && debugAllowed && showDebugOverlay && category === "necklace" && (
          <div className="mt-3 rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">
            <label className="flex items-center gap-3">
              <span className="whitespace-nowrap">
                Horizontal offset (fraction of shoulder width):{" "}
                <span className="font-mono text-lime-300">{neckHorizontalOffsetPreview.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={-0.3}
                max={0.3}
                step={0.01}
                value={neckHorizontalOffsetPreview}
                onChange={(e) => {
                  setNeckHorizontalOffsetPreview(Number(e.target.value));
                  setNeckHorizontalOffsetSavedJustNow(false);
                }}
                className="flex-1"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={() => {
                  saveNeckHorizontalOffsetOverride(neckHorizontalOffsetPreview);
                  setSavedNeckHorizontalOffset(neckHorizontalOffsetPreview);
                  setNeckHorizontalOffsetSavedJustNow(true);
                }}
              >
                Done -- fix at {neckHorizontalOffsetPreview.toFixed(2)}
              </Button>
              <button
                type="button"
                className="whitespace-nowrap text-neutral-400 underline-offset-2 hover:underline"
                onClick={() => {
                  setNeckHorizontalOffsetPreview(0);
                  setNeckHorizontalOffsetSavedJustNow(false);
                }}
              >
                Reset slider to automatic (0.00)
              </button>
              {savedNeckHorizontalOffset !== null && (
                <button
                  type="button"
                  className="whitespace-nowrap text-neutral-400 underline-offset-2 hover:underline"
                  onClick={() => {
                    clearSavedNeckHorizontalOffsetOverride();
                    setSavedNeckHorizontalOffset(null);
                    setNeckHorizontalOffsetPreview(0);
                    setNeckHorizontalOffsetSavedJustNow(false);
                  }}
                >
                  Clear saved fix (go back to automatic)
                </button>
              )}
              {neckHorizontalOffsetSavedJustNow && (
                <span className="text-lime-400">Saved -- this position is now fixed on this device.</span>
              )}
              {!neckHorizontalOffsetSavedJustNow && savedNeckHorizontalOffset !== null && (
                <span className="text-neutral-500">Currently fixed at {savedNeckHorizontalOffset.toFixed(2)} on this device.</span>
              )}
            </div>
            <p className="mt-2 text-[10px] text-neutral-500">
              0 = centered on the shoulder midpoint (the automatic default). Dragging changes what you see live, on
              this frame, so you can nudge it left or right against your real camera until it sits exactly on your
              neckline. Once you click Done, that exact offset is fixed for every necklace try-on in this browser,
              debug panel open or not, until you clear it.
            </p>
          </div>
        )}

        {showPicker && debugAllowed && showDebugOverlay && category === "necklace" && session.debugSnapshot && (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-neutral-950 p-3 text-[10px] leading-relaxed text-lime-300">
            {formatNecklaceDebugSnapshot(session.debugSnapshot)}
          </pre>
        )}

        {/* Phase 2.5D Step 21: which representation (flat-2D / curved-2.5D / gltf-3D)
            actually produced this frame -- see useLiveArSession.ts's own live3dDebugInfo
            doc comment for exactly what "none" vs a real mode means. */}
        {showPicker && debugAllowed && showDebugOverlay && category === "necklace" && (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-neutral-950 p-3 text-[10px] leading-relaxed text-sky-300">
            {formatLive3dDebugInfo(session.live3dDebugInfo)}
          </pre>
        )}

        {showPicker && captureState === "done" && captureUrl && (
          <p className="mt-3 text-sm text-neutral-500">
            Saved.{" "}
            <a href={captureUrl} target="_blank" rel="noreferrer" className="underline">
              View your capture
            </a>
            .
          </p>
        )}
        {showPicker && captureState === "error" && captureErrorMessage && (
          <p className="mt-3 text-sm text-red-500">{captureErrorMessage}</p>
        )}
      </div>

      {showPicker && (
      <div
        // Positioned relative to the page's own positioned ancestor (lg:absolute), not
        // the viewport and not the flex layout -- see the lg:absolute writeup this
        // replaced for why. right/top are temporarily driven by panelRightPx/panelTopPx
        // (below, via the nudge arrows) instead of hardcoded Tailwind values while this
        // is being recalibrated directly against production.
        className="relative w-full overflow-hidden rounded-[2rem] shadow-[0_8px_30px_-10px_rgba(0,0,0,0.15)] lg:absolute lg:h-[600px] lg:w-[420px]"
        style={isLgUp ? { right: panelRightPx, top: panelTopPx } : undefined}
      >
        <h2 className="sr-only">On the model</h2>
        <BotPreview
          category={category}
          primaryAsset={assetWithPreviewQuery.data ?? null}
          additionalItems={category === "necklace" ? additionalNecklaceItems : []}
          neckFractionOverride={neckFractionPreview}
          neckHorizontalOffsetOverride={neckHorizontalOffsetPreview}
        />

        {/* Decorative only -- no handwritten-script font/illustration assets exist in
            this project, so this is a tasteful approximation of the brand mockup's
            corner treatment with the existing serif display font, not a literal
            reproduction. */}
        <p className="pointer-events-none absolute right-5 top-6 text-right font-[family-name:var(--font-display)] text-lg italic leading-tight text-neutral-700/80 [text-shadow:0_1px_2px_rgba(255,255,255,0.6)]">
          Traditional
          <br />
          Elegance
          <br />
          Reimagined
          <span className="mt-1 block h-0.5 w-14 rounded-full bg-[#C90016]" />
        </p>

        {/* The model preview above is already always-visible (not behind a toggle), so
            this button has nothing to "open" -- it's a non-interactive label matching
            the mockup's pill, not a fabricated feature. */}
        <span className="pointer-events-none absolute bottom-5 right-5 flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-xs font-medium text-neutral-800 shadow-sm backdrop-blur">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          View on Model
        </span>
      </div>
      )}

      {/* Temporary calibration tool -- see the panelRightPx/panelTopPx/isLgUp state
          above. Remove this whole block once the final position is confirmed. */}
      {showPicker && (
        <div className="fixed bottom-5 left-5 z-50 flex flex-col items-center gap-2 rounded-2xl bg-neutral-900/90 p-3 text-white shadow-lg">
          <p className="text-xs">
            right: {panelRightPx} top: {panelTopPx}
          </p>
          <button
            type="button"
            onClick={() => setPanelTopPx((v) => v - 10)}
            className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
          >
            Up
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPanelRightPx((v) => v + 10)}
              className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            >
              Left
            </button>
            <button
              type="button"
              onClick={() => setPanelRightPx((v) => v - 10)}
              className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            >
              Right
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPanelTopPx((v) => v + 10)}
            className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
          >
            Down
          </button>
        </div>
      )}
    </div>
  );
}
