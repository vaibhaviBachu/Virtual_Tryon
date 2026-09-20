"use client";

import { useEffect, useRef, useState } from "react";

import type { AssetWithPreviewResponse } from "@/lib/catalogue-types";
import { loadJewelleryAssetTexture } from "@/lib/live-ar/asset-cache";
import { NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH } from "@/lib/live-ar/constants";
import { planCategoryRenders } from "@/lib/live-ar/geometry";
import { drawJewelleryOverlay } from "@/lib/live-ar/renderer";
import { createImageTrackers, detectStaticImage, type LiveTrackers } from "@/lib/live-ar/tracking";
import type { CategorySlug, JewelleryAssetGeometry, LiveFaceLandmarks, LivePoseLandmarks } from "@/lib/live-ar/types";

const MODEL_IMAGE_SRC = "/live-ar/model-red-saree.webp";

export interface BotPreviewItem {
  jewelleryId: string;
  asset: AssetWithPreviewResponse | null;
}

/**
 * Static "catalogue model" preview -- a fixed photo (a person in a plain red saree)
 * that the currently selected jewellery is composited onto, shown alongside the live
 * camera so a customer can see the piece on a clean reference photo too, not only on
 * themselves. Deliberately reuses the exact same geometry pipeline as the live camera
 * (computeAnchor/computeScale/computeRotation via planCategoryRenders, and
 * drawJewelleryOverlay) so placement logic never forks into two implementations --
 * the only difference is WHERE face/pose landmarks come from: one MediaPipe detection
 * pass over this fixed image (IMAGE running mode, see tracking.ts's
 * createImageTrackers), run once and cached, instead of every video frame. No
 * TrackingStateMachine/smoothing here either -- those exist to smooth out jitter
 * across live frames, which a single static detection has none of.
 */
export function BotPreview({
  category,
  primaryAsset,
  additionalItems = [],
  necklaceLength = null,
}: {
  category: CategorySlug;
  primaryAsset: AssetWithPreviewResponse | null;
  additionalItems?: BotPreviewItem[];
  necklaceLength?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelImageRef = useRef<HTMLImageElement | null>(null);
  const trackersRef = useRef<LiveTrackers | null>(null);

  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [detection, setDetection] = useState<{ face: LiveFaceLandmarks | null; pose: LivePoseLandmarks | null } | null>(null);

  // Load the model photo and run ONE detection pass against it -- once, ever, for the
  // lifetime of this component (the photo never changes), not per selection change.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = async () => {
      if (cancelled) return;
      modelImageRef.current = img;
      try {
        const trackers = await createImageTrackers();
        if (cancelled) {
          trackers.close();
          return;
        }
        trackersRef.current = trackers;
        const result = detectStaticImage(trackers, img);
        if (cancelled) return;
        setDetection(result);
        setModelStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setModelError(err instanceof Error ? err.message : "Could not analyze the model photo.");
          setModelStatus("error");
        }
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setModelError("Could not load the model photo.");
        setModelStatus("error");
      }
    };
    img.src = MODEL_IMAGE_SRC;
    return () => {
      cancelled = true;
      trackersRef.current?.close();
      trackersRef.current = null;
    };
  }, []);

  // Load textures for the primary item + every additionally layered item -- same
  // cached loader the live camera session uses (asset-cache.ts caches by asset id, so
  // this never re-fetches/re-decodes something the live view already loaded).
  const allItems: BotPreviewItem[] = primaryAsset
    ? [{ jewelleryId: "primary", asset: primaryAsset }, ...additionalItems]
    : additionalItems;
  const itemsKey = allItems.map((item) => `${item.jewelleryId}:${item.asset?.preview_url ?? ""}`).join("|");
  const [geometryById, setGeometryById] = useState<Map<string, { image: HTMLImageElement; geometry: JewelleryAssetGeometry }>>(
    new Map()
  );
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      allItems
        .filter((item) => item.asset?.preview_url)
        .map((item) =>
          loadJewelleryAssetTexture(item.asset!, item.asset!.preview_url!).then((loaded) => [item.jewelleryId, loaded] as const)
        )
    ).then((loaded) => {
      if (cancelled) return;
      setGeometryById(new Map(loaded));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  // Draw: model photo, then each selected item's overlay, positioned via the real
  // detected landmarks from this photo -- never redone per frame, only when the
  // selection (or the one-time detection result) changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const modelImage = modelImageRef.current;
    if (!canvas || !modelImage || modelStatus !== "ready") return;

    const widthPx = modelImage.naturalWidth;
    const heightPx = modelImage.naturalHeight;
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.drawImage(modelImage, 0, 0, widthPx, heightPx);

    const face = detection?.face ?? null;
    const pose = detection?.pose ?? null;
    if (!face && !pose) return;

    allItems.forEach((item, index) => {
      const loaded = geometryById.get(item.jewelleryId);
      if (!loaded) return;
      const layerOffset = category === "necklace" ? index * NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH : undefined;
      const plans = planCategoryRenders(
        category,
        loaded.geometry,
        face,
        pose,
        widthPx,
        heightPx,
        necklaceLength,
        undefined,
        undefined,
        layerOffset
      );
      for (const plan of plans) {
        if (plan.transform) drawJewelleryOverlay(ctx, loaded.image, plan.transform, 1);
      }
    });
  }, [detection, modelStatus, geometryById, allItems, category, necklaceLength]);

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-950 dark:border-neutral-800">
      {modelStatus === "error" ? (
        <div className="flex aspect-[2/3] items-center justify-center p-4 text-center text-xs text-neutral-400">
          {modelError}
        </div>
      ) : (
        <div className="relative">
          <canvas ref={canvasRef} className="w-full h-auto" />
          {modelStatus === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
              Loading model preview…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
