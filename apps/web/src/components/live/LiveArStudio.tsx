"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAsset, listAssets, listCategories, listJewellery } from "@/lib/catalogue-api";
import { createLiveArCapture } from "@/lib/live-ar-api";
import { formatNecklaceDebugSnapshot } from "@/lib/live-ar/debug";
import { NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH } from "@/lib/live-ar/constants";
import { formatPerformanceOverlayText } from "@/lib/live-ar/performance";
import { createTryOnSession } from "@/lib/tryon-api";
import type { CategorySlug } from "@/lib/live-ar/types";
import { cn } from "@/lib/utils";
import { useLiveArSession } from "@/components/live/useLiveArSession";

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
export function LiveArStudio() {
  const [category, setCategory] = useState<CategorySlug>("earrings");
  const [selectedJewelleryId, setSelectedJewelleryId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showPerfOverlay, setShowPerfOverlay] = useState(false);
  // Necklace geometry debug mode (temporary diagnostic tooling -- see debug.ts):
  // draws face/shoulder/neck/jewellery attachment points on the live canvas and shows
  // their raw numeric values, so a real-camera placement question can be answered with
  // actual runtime numbers instead of a screenshot and a guess.
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  // Live-tunable preview of NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH (temporary
  // calibration tooling -- see neck-reference.ts's computeNeckReferenceFrame
  // docstring). Dragging this changes the ACTUAL rendered position in real time so the
  // right value can be found against a real camera without a rebuild per attempt; it
  // does not persist anywhere -- once a value looks right, it gets typed into
  // constants.ts as the new shipped default and this resets back to that constant.
  const [neckFractionPreview, setNeckFractionPreview] = useState(NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH);
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

  const jewelleryQuery = useQuery({
    queryKey: ["live-ar-jewellery", activeCategoryId],
    queryFn: () => listJewellery({ categoryId: activeCategoryId ?? undefined, page: 1, pageSize: 24 }),
    enabled: activeCategoryId !== null,
  });

  // Switching jewellery never restarts the camera or reloads the page (spec §12/§20):
  // this just changes which cached texture the render loop reads.
  useEffect(() => {
    const items = jewelleryQuery.data?.items;
    if (items && items.length > 0 && !items.some((item) => item.id === selectedJewelleryId)) {
      setSelectedJewelleryId(items[0].id);
    }
  }, [jewelleryQuery.data, selectedJewelleryId]);

  const assetsQuery = useQuery({
    queryKey: ["live-ar-assets", selectedJewelleryId],
    queryFn: () => listAssets(selectedJewelleryId!),
    enabled: selectedJewelleryId !== null,
  });
  const processedAssetSummary = assetsQuery.data?.find((a) => a.asset_type === "processed" && a.processing_status === "ready");

  const assetWithPreviewQuery = useQuery({
    queryKey: ["live-ar-asset-preview", processedAssetSummary?.id],
    queryFn: () => getAsset(processedAssetSummary!.id),
    enabled: !!processedAssetSummary,
  });

  const session = useLiveArSession({
    category,
    jewelleryId: selectedJewelleryId,
    asset: assetWithPreviewQuery.data ?? null,
    debugEnabled: showDebugOverlay,
    debugNeckFractionOverride: category === "necklace" && showDebugOverlay ? neckFractionPreview : null,
  });

  async function handleCapture() {
    if (!sessionId || !selectedJewelleryId) return;
    setCaptureState("capturing");
    setCaptureErrorMessage(null);
    try {
      const blob = await session.captureFrame();
      if (!blob) throw new Error("The camera isn't ready yet.");
      const capture = await createLiveArCapture(sessionId, selectedJewelleryId, processedAssetSummary?.id ?? null, blob);
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
                onChange={(e) => setNeckFractionPreview(Number(e.target.value))}
                className="flex-1"
              />
              <button
                type="button"
                className="whitespace-nowrap text-neutral-400 underline-offset-2 hover:underline"
                onClick={() => setNeckFractionPreview(NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH)}
              >
                Reset to shipped ({NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH.toFixed(2)})
              </button>
            </label>
            <p className="mt-1 text-[10px] text-neutral-500">
              0 = right at the chin, 1 = right at the shoulder line. This changes what you see live so the correct
              value can be found against your real camera -- it isn&apos;t saved anywhere. Once it looks right, report
              the number back so it can be shipped as the new default.
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
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Choose a piece</h2>
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
      </div>
    </div>
  );
}
