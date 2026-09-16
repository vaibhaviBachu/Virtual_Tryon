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
