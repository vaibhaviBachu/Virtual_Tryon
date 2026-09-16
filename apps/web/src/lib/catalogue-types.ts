/**
 * Types mirroring the Milestone 2 backend Pydantic response schemas exactly
 * (apps/api/v1/schemas/{category,jewellery,asset,pagination}.py). Kept as a single
 * source of truth here so every catalogue component imports the same shapes rather than
 * redefining ad hoc interfaces.
 */

export interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  anchor_type: string | null;
  placement_config: Record<string, unknown>;
  is_active: boolean;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface JewelleryResponse {
  id: string;
  category_id: string;
  category: CategoryResponse;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  price: number | null;
  currency: string | null;
  physical_width_mm: number | null;
  physical_height_mm: number | null;
  physical_depth_mm: number | null;
  weight_g: number | null;
  extra_measurements: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type AssetType = "original" | "processed" | "thumbnail";
export type ProcessingStatus = "pending" | "processing" | "ready" | "failed";

export interface AssetResponse {
  id: string;
  jewellery_id: string;
  asset_type: AssetType;
  mime_type: string | null;
  width_px: number | null;
  height_px: number | null;
  file_size_bytes: number | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetWithPreviewResponse extends AssetResponse {
  preview_url: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface JewelleryCreateInput {
  category_id: string;
  name: string;
  slug: string;
  description?: string;
  sku: string;
  price?: number;
  currency?: string;
  physical_width_mm?: number;
  physical_height_mm?: number;
  physical_depth_mm?: number;
  weight_g?: number;
  is_active?: boolean;
}

export interface CategoryCreateInput {
  name: string;
  slug: string;
  description?: string;
  anchor_type?: string;
}
