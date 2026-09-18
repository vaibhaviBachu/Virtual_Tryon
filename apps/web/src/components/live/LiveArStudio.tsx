"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAsset, listAssets, listCategories, listJewellery } from "@/lib/catalogue-api";
import { createLiveArCapture } from "@/lib/live-ar-api";
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
              <Button onClick={handleCapture} disabled={isLoadingPipeline || captureState === "capturing"}>
                {captureState === "capturing" ? "Saving…" : "Capture"}
              </Button>
            </div>
          </CardContent>
        </Card>

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
