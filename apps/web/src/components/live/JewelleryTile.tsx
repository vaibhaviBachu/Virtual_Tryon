"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAsset, listAssets } from "@/lib/catalogue-api";
import type { JewelleryResponse } from "@/lib/catalogue-types";
import { cn } from "@/lib/utils";

/**
 * One catalogue tile in the browse grid: the item's real processed photo (same asset
 * the live session itself renders), its name/SKU, and a camera button that jumps
 * straight into the full-screen live try-on for THIS item (see LiveArStudio's onTryOn).
 * Tapping the photo itself only previews the item on the static "on the model" panel,
 * without leaving the catalogue. The heart/wishlist toggle is local-only UI state (no
 * backend wishlist exists) -- purely cosmetic, matches the brand mockup's card design.
 */
export function JewelleryTile({
  item,
  isSelected,
  onSelect,
  onTryOn,
}: {
  item: JewelleryResponse;
  isSelected: boolean;
  onSelect: () => void;
  onTryOn: () => void;
}) {
  const [wishlisted, setWishlisted] = useState(false);
  const assetsQuery = useQuery({
    queryKey: ["catalogue-tile-assets", item.id],
    queryFn: () => listAssets(item.id),
  });
  const processedAssetId = assetsQuery.data?.find(
    (a) => a.asset_type === "processed" && a.processing_status === "ready"
  )?.id;
  const previewQuery = useQuery({
    queryKey: ["catalogue-tile-preview", processedAssetId],
    queryFn: () => getAsset(processedAssetId!),
    enabled: processedAssetId !== undefined,
  });
  const previewUrl = previewQuery.data?.preview_url ?? null;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md",
        isSelected ? "border-red-400" : "border-neutral-100"
      )}
    >
      <div className="relative">
        <button type="button" onClick={onSelect} aria-label={`Preview ${item.name} on the model`} className="block w-full text-left">
          <div className="flex aspect-square items-center justify-center bg-white">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={item.name} className="h-full w-full object-contain p-2" />
            ) : (
              <span className="px-2 text-center text-[10px] text-neutral-400">
                {assetsQuery.isLoading || previewQuery.isLoading ? "Loading…" : "No photo yet"}
              </span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setWishlisted((v) => !v);
          }}
          aria-label={wishlisted ? `Remove ${item.name} from wishlist` : `Add ${item.name} to wishlist`}
          aria-pressed={wishlisted}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-400 shadow-sm hover:text-red-500"
        >
          <svg
            viewBox="0 0 24 24"
            fill={wishlisted ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("h-4 w-4", wishlisted && "text-red-500")}
          >
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
          </svg>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTryOn();
          }}
          aria-label={`Try ${item.name} on with the camera`}
          className="absolute -bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white shadow-md hover:bg-red-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>

      <div className="px-3 pb-3 pt-4">
        <p className="truncate text-base font-bold text-neutral-900">{item.name}</p>
        <p className="text-xs font-bold text-neutral-500">SKU: {item.sku}</p>
      </div>
    </div>
  );
}
