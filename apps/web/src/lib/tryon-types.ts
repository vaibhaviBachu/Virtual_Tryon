export interface TryOnSession {
  id: string;
  user_id: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface UserImageResponse {
  id: string;
  session_id: string;
  mime_type: string;
  capture_source: string;
  original_width_px: number | null;
  original_height_px: number | null;
  normalized_width_px: number | null;
  normalized_height_px: number | null;
  file_size_bytes: number | null;
  created_at: string;
}

export type TryOnRequestStatus =
  | "created"
  | "uploaded"
  | "queued"
  | "processing"
  | "landmarks_ready"
  | "segmentation_ready"
  | "ready"
  | "failed";

export interface ReadinessSummary {
  face_ready: boolean;
  ears_ready: boolean;
  left_ear_ready: boolean;
  right_ear_ready: boolean;
  neck_ready: boolean;
  hands_ready: boolean;
  reasons: Record<string, string>;
  raw_confidences: Record<string, number>;
  // Milestone 4 stabilization ("necklace framing"): moved the framing check earlier
  // (right after analysis, before item selection). `necklace_ready` combines the
  // original neck_ready (shoulders confidently detected) with this new framing signal
  // (enough room below the anchor for a typical necklace) and is what the UI should
  // prefer; both are optional so older cached responses without them still render.
  necklace_framing_ready?: boolean;
  necklace_ready?: boolean;
  framing_metrics?: Record<string, unknown>;
}

export interface TryOnRequestResponse {
  id: string;
  session_id: string;
  user_image_id: string;
  status: TryOnRequestStatus;
  error_message: string | null;
  confidence: Record<string, number> | null;
  readiness: ReadinessSummary | null;
  metrics: Record<string, number> | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// --- Milestone 4: geometry try-on rendering ---

export interface CategoryOptionResponse {
  id: string;
  slug: string;
  name: string;
  // Real backend flag (spec §26) — only "earrings"/"necklace" are true in Milestone 4.
  // The frontend must never hard-code which categories can render.
  functional: boolean;
}

export type TryOnRenderStatus = "queued" | "processing" | "ready" | "failed" | "blocked";

export interface TryOnRenderResponse {
  id: string;
  request_id: string;
  jewellery_id: string;
  asset_id: string | null;
  category_slug: string;
  status: TryOnRenderStatus;
  error_code: string | null;
  error_message: string | null;
  // Signed, short-lived — only populated once status === "ready".
  result_image_url: string | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}
