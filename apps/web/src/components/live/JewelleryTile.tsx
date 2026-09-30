"use client";

import { useQuery } from "@tanstack/react-query";

import { getAsset, listAssets } from "@/lib/catalogue-api";
import type { JewelleryResponse } from "@/lib/catalogue-types";
import { cn } from "@/lib/utils";

/**
 * One catalogue tile in the browse grid: the item's real processed photo (same asset
 * the live session itself renders), its SKU, and a camera button that jumps straight
 * into the full-screen live try-on for THIS item (see LiveArStudio's onTryOn). Tapping
 * the photo itself only previews the item on the static "on the model" panel, without
 * leaving the catalogue.
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
        "flex flex-col overflow-hidden rounded-xl border",
        isSelected ? "border-neutral-900 dark:border-amber-400" : "border-neutral-200 dark:border-neutral-800"
      )}
    >
      <button type="button" onClick={onSelect} aria-label={`Preview ${item.name} on the model`} className="block text-left">
        <div className="flex aspect-square items-center justify-center bg-white">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={item.name} className="h-full w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-[10px] text-neutral-400">
              {assetsQuery.isLoading || previewQuery.isLoading ? "Loading…" : "No photo yet"}
            </span>
          )}
        </div>
      </button>
      <div className="flex items-center justify-between gap-1 border-t border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
        <span className="truncate text-[10px] text-neutral-500">SKU:{item.sku}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTryOn();
          }}
          aria-label={`Try ${item.name} on with the camera`}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
