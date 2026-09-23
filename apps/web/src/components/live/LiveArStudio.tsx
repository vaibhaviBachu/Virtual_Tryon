"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAsset, listAssets, listCategories, listJewellery } from "@/lib/catalogue-api";
import { createLiveArCapture } from "@/lib/live-ar-api";
import { formatNecklaceDebugSnapshot } from "@/lib/live-ar/debug";
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
import { formatOcclusionDebugText, formatPerformanceOverlayText, formatSegmentationDebugText } from "@/lib/live-ar/performance";
import { createTryOnSession } from "@/lib/tryon-api";
import type { CategorySlug } from "@/lib/live-ar/types";
import { cn } from "@/lib/utils";
import { useLiveArSession } from "@/components/live/useLiveArSession";
import { BotPreview } from "@/components/live/BotPreview";

// Only these two categories have a functional Live AR pipeline this milestone (spec
// §26's "do not simultaneously implement all future jewellery categories" rule,
// mirrored from Milestone 4's FUNCTIONAL_CATEGORY_SLUGS).
const LIVE_AR_CATEGORIES: { slug: CategorySlug; label: string }[] = [
  { slug: "earrings", label: "Earrings" },
  { slug: "necklace", label: "Necklace" },
];

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
  const [category, setCategory] = useState<CategorySlug>("earrings");
  const [selectedJewelleryId, setSelectedJewelleryId] = useState<string | null>(null);
  // Necklace mode supports wearing multiple neck items at once (e.g. a short necklace
  // together with a long haaram) -- see docs/live-ar-architecture.md. Earrings mode
  // stays single-select via selectedJewelleryId above; this is necklace-only. Ordered:
  // the first entry is the "primary" item (reuses the existing single-asset plumbing
  // below), everything after it is layered further down the neck.
  const [selectedNecklaceIds, setSelectedNecklaceIds] = useState<string[]>([]);
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
  // Necklace mode's full pickable list: plain necklace items plus haaram items,
  // combined -- see selectedNecklaceIds above.
  const neckItems = useMemo(
    () => (category === "necklace" ? [...(jewelleryQuery.data?.items ?? []), ...(haaramItemsQuery.data?.items ?? [])] : []),
    [category, jewelleryQuery.data, haaramItemsQuery.data]
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
  const additionalNecklaceItems = additionalNeckIds.map((id, index) => ({
    jewelleryId: id,
    asset: additionalAssetQueries[index]?.data ?? null,
  }));

  const session = useLiveArSession({
    category,
    jewelleryId: primaryId,
    asset: assetWithPreviewQuery.data ?? null,
    additionalNecklaceItems: category === "necklace" ? additionalNecklaceItems : [],
    debugEnabled: showDebugOverlay,
    // While the debug panel is open, the slider previews live (even before it's saved).
    // Otherwise, fall back to whatever's been saved for this browser (if anything) --
    // this is what makes "drag it, click Done" actually stick for ordinary use, not
    // just while the debug panel happens to be open.
    debugNeckFractionOverride: category === "necklace" ? (showDebugOverlay ? neckFractionPreview : savedNeckFraction) : null,
    debugNeckHorizontalOffsetOverride:
      category === "necklace" ? (showDebugOverlay ? neckHorizontalOffsetPreview : savedNeckHorizontalOffset) : null,
    showSegmentationDebug,
    showOcclusionDebug,
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row">
      <div className="flex-1">
        <Card className="overflow-hidden">
          <div className="relative aspect-[4/3] w-full bg-neutral-950">
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

            {showPerfOverlay && (
              <div className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-lime-300">
                {formatPerformanceOverlayText(session.performance)}
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
              <div className="absolute right-3 bottom-3 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-rose-300">
                {formatOcclusionDebugText(session.occlusionDebugInfo, session.performance.occlusion)}
              </div>
            )}
          </div>

          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              {LIVE_AR_CATEGORIES.map((c) => (
                <Button
                  key={c.slug}
                  variant={category === c.slug ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setCategory(c.slug)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3">
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
              {/* M6.3 proof of concept -- dev-only, never part of the customer
                  experience (docs/live-ar-realism-architecture.md §6/§7/§17). */}
              <button
                type="button"
                className="text-xs text-neutral-400 underline-offset-2 hover:underline"
                onClick={() => setShowSegmentationDebug((v) => !v)}
              >
                {showSegmentationDebug ? "Hide" : "Show"} segmentation debug
              </button>
              {/* M6.4 -- dev-only, never part of the customer experience
                  (docs/live-ar-realism-architecture.md §6/§7/§17). */}
              {category === "necklace" && (
                <button
                  type="button"
                  className="text-xs text-neutral-400 underline-offset-2 hover:underline"
                  onClick={() => setShowOcclusionDebug((v) => !v)}
                >
                  {showOcclusionDebug ? "Hide" : "Show"} occlusion debug
                </button>
              )}
              <Button onClick={handleCapture} disabled={isLoadingPipeline || captureState === "capturing"}>
                {captureState === "capturing" ? "Saving…" : "Capture"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {showDebugOverlay && category === "necklace" && (
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

        {showDebugOverlay && category === "necklace" && (
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

        {showDebugOverlay && category === "necklace" && session.debugSnapshot && (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-neutral-950 p-3 text-[10px] leading-relaxed text-lime-300">
            {formatNecklaceDebugSnapshot(session.debugSnapshot)}
          </pre>
        )}

        {captureState === "done" && captureUrl && (
          <p className="mt-3 text-sm text-neutral-500">
            Saved.{" "}
            <a href={captureUrl} target="_blank" rel="noreferrer" className="underline">
              View your capture
            </a>
            .
          </p>
        )}
        {captureState === "error" && captureErrorMessage && (
          <p className="mt-3 text-sm text-red-500">{captureErrorMessage}</p>
        )}
      </div>

      <div className="w-full lg:w-72">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">On the model</h2>
        <BotPreview
          category={category}
          primaryAsset={assetWithPreviewQuery.data ?? null}
          additionalItems={category === "necklace" ? additionalNecklaceItems : []}
        />

        <h2 className="mb-3 mt-6 text-sm font-medium text-neutral-500">
          {category === "necklace" ? "Choose pieces to layer" : "Choose a piece"}
        </h2>
        {category === "necklace" ? (
          <>
            <p className="mb-2 text-[11px] text-neutral-400">
              Pick more than one to wear them together (e.g. a necklace and a haaram) -- up to{" "}
              {MAX_SIMULTANEOUS_NECK_ITEMS} at once.
            </p>
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
              {neckItems.map((item) => {
                const isSelected = selectedNecklaceIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleNecklaceItem(item.id)}
                    className={cn(
                      "rounded-xl border p-2 text-left text-xs",
                      isSelected ? "border-neutral-900 dark:border-amber-400" : "border-neutral-200 dark:border-neutral-800"
                    )}
                  >
                    <span className="mr-1">{isSelected ? "☑" : "☐"}</span>
                    {item.name}
                    <span className="block text-[10px] text-neutral-400">{item.category.name}</span>
                  </button>
                );
              })}
              {neckItems.length === 0 && (
                <p className="col-span-full text-xs text-neutral-400">No necklace or haaram items yet.</p>
              )}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
            {(jewelleryQuery.data?.items ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedJewelleryId(item.id)}
                className={cn(
                  "rounded-xl border p-2 text-left text-xs",
                  item.id === selectedJewelleryId
                    ? "border-neutral-900 dark:border-amber-400"
                    : "border-neutral-200 dark:border-neutral-800"
                )}
              >
                {item.name}
              </button>
            ))}
            {jewelleryQuery.data?.items.length === 0 && (
              <p className="col-span-full text-xs text-neutral-400">No items in this category yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
