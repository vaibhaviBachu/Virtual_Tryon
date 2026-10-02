/**
 * Types mirroring the AI Jewellery Assistant backend schemas exactly
 * (apps/api/v1/schemas/jewellery_ai.py) — single source of truth for every assistant
 * component, same convention as catalogue-types.ts.
 */

export type IntakeStatus = "created" | "image_ready" | "metadata_ready" | "submitted" | "failed";

// Distinct from ai_image_enhanced (a plain bool) -- lets the UI tell the customer the
// real reason a photo wasn't AI-prepared, instead of one generic message regardless of
// whether AI was never configured, errored out, or ran but produced something that
// still doesn't look like an isolated product photo.
export type ImagePreparationStatus = "not_configured" | "failed" | "rejected" | "success";

export interface IntakeMetadata {
  name?: string | null;
  category_slug?: string | null;
  size?: "Small" | "Medium" | "Large" | null;
  style?: string | null;
  material?: string | null;
  stone?: string | null;
  description?: string | null;
  tags?: string[] | null;
  physical_width_mm?: number | null;
  physical_height_mm?: number | null;
  physical_depth_mm?: number | null;
  weight_g?: number | null;
}

export interface IntakeResponse {
  id: string;
  status: IntakeStatus;
  content_hash: string | null;
  original_preview_url: string | null;
  prepared_preview_url: string | null;
  ai_image_enhanced: boolean;
  image_preparation_status: ImagePreparationStatus;
  image_generation_attempts: number;
  suggested_metadata: IntakeMetadata;
  user_metadata: IntakeMetadata;
  duplicate_of_jewellery_id: string | null;
  jewellery_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmitResponse {
  intake: IntakeResponse;
  jewellery_id: string;
}
