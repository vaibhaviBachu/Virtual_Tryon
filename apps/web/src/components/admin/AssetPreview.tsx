"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { getAsset } from "@/lib/catalogue-api";
import type { AssetResponse, AssetWithPreviewResponse } from "@/lib/catalogue-types";

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
};

/**
 * Shows one asset row, polling the real processing_status while it's pending/processing
 * (Milestone 2 spec: no fake progress, poll the real backend state) and rendering the
 * real signed preview image over a checkerboard background once ready — the standard
 * way to make PNG transparency visually obvious, since a transparent processed cutout
 * on a plain white card background would be indistinguishable from an opaque white one.
 */
export function AssetPreview({ asset }: { asset: AssetResponse }) {
  const assetQuery = useQuery<AssetWithPreviewResponse>({
    queryKey: ["asset", asset.id],
    queryFn: () => getAsset(asset.id),
    initialData: { ...asset, preview_url: null },
    refetchInterval: (query) => {
      const status = query.state.data?.processing_status;
      return status === "pending" || status === "processing" ? 2000 : false;
    },
  });

  const current = assetQuery.data;
  const isInFlight = current.processing_status === "pending" || current.processing_status === "processing";

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800"
        style={CHECKERBOARD_STYLE}
      >
        {/* Signed, short-lived remote URLs from object storage aren't suited to
            next/image's static optimization pipeline, so a plain <img> is used here —
            accepting the eslint-disabled next/next/no-img-element warning below. */}
        {current.processing_status === "ready" && current.preview_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.preview_url} alt={`${asset.asset_type} preview`} className="h-full w-full object-contain" />
        )}
        {current.processing_status !== "ready" && (
          <span className="px-2 text-center text-[10px] text-neutral-500">
            {current.processing_status === "failed" ? "Failed" : "No preview"}
          </span>
        )}
      </div>
      <span className="text-xs text-neutral-500">{asset.asset_type}</span>
      <Badge>{isInFlight ? "Processing…" : current.processing_status}</Badge>
      {current.processing_status === "failed" && current.processing_error && (
        <p role="alert" className="max-w-[8rem] text-center text-[10px] text-red-600 dark:text-red-400">
          {current.processing_error}
        </p>
      )}
    </div>
  );
}
