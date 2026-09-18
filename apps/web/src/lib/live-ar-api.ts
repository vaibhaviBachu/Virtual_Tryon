import { API_BASE_URL } from "@/lib/config";
import { ApiError } from "@/lib/catalogue-api";

/**
 * Typed client for the Milestone 5 Live AR API surface. Deliberately tiny: per the
 * spec, the backend has no per-frame endpoint, so this file has exactly two functions --
 * everything else Live AR needs from the network (categories, jewellery, asset preview
 * URLs) already exists in catalogue-api.ts and tryon-api.ts (createTryOnSession is
 * reused directly for a Live AR session; see LiveArStudio).
 */

export interface LiveArCaptureResponse {
  id: string;
  session_id: string;
  jewellery_id: string;
  asset_id: string | null;
  category_slug: string;
  mime_type: string;
  width_px: number | null;
  height_px: number | null;
  file_size_bytes: number | null;
  result_url: string;
  created_at: string;
  updated_at: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body -- keep the generic message
    }
    throw new ApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export async function createLiveArCapture(
  sessionId: string,
  jewelleryId: string,
  assetId: string | null,
  blob: Blob
): Promise<LiveArCaptureResponse> {
  const params = new URLSearchParams({ session_id: sessionId, jewellery_id: jewelleryId });
  if (assetId) params.set("asset_id", assetId);
  const formData = new FormData();
  formData.append("file", blob, "capture.jpg");
  return request(`/api/v1/live-ar/captures?${params.toString()}`, { method: "POST", body: formData });
}

export async function getLiveArCapture(captureId: string): Promise<LiveArCaptureResponse> {
  return request(`/api/v1/live-ar/captures/${captureId}`);
}
