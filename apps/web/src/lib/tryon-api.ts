import { API_BASE_URL } from "@/lib/config";
import { ApiError } from "@/lib/catalogue-api";
import type {
  CategoryOptionResponse,
  TryOnRenderResponse,
  TryOnRequestResponse,
  TryOnSession,
  UserImageResponse,
} from "@/lib/tryon-types";

/**
 * Typed client for the Milestone 3 user-image-pipeline API. Guest sessions work with no
 * token at all (see apps/api/core/auth_deps.get_current_user_optional) — `token` is
 * always optional here, unlike the admin-only catalogue client.
 */
async function request<T>(path: string, options: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(rest.body && !(rest.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export async function createTryOnSession(
  deviceInfo: Record<string, unknown> = {},
  token?: string | null
): Promise<TryOnSession> {
  return request("/api/v1/tryon/sessions", {
    method: "POST",
    body: JSON.stringify({ device_info: deviceInfo }),
    token,
  });
}

export async function uploadTryOnImage(
  sessionId: string,
  file: Blob,
  captureSource: "camera" | "upload",
  token?: string | null
): Promise<UserImageResponse> {
  const formData = new FormData();
  formData.append("file", file, "photo.jpg");
  return request(`/api/v1/tryon/sessions/${sessionId}/image?capture_source=${captureSource}`, {
    method: "POST",
    body: formData,
    token,
  });
}

export async function createTryOnRequest(
  sessionId: string,
  userImageId: string,
  token?: string | null
): Promise<TryOnRequestResponse> {
  return request("/api/v1/tryon/requests", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, user_image_id: userImageId }),
    token,
  });
}

export async function getTryOnRequest(requestId: string, token?: string | null): Promise<TryOnRequestResponse> {
  return request(`/api/v1/tryon/requests/${requestId}`, { token });
}

const TERMINAL_STATUSES = new Set(["ready", "failed"]);

/**
 * Polls GET /requests/{id} until a terminal status (`ready`/`failed`), never a fake
 * progress percentage — every intermediate status shown to the user IS the real
 * backend-reported state (see studio-steps.ts's STATUS_LABELS for the copy).
 */
export async function pollTryOnRequest(
  requestId: string,
  onUpdate: (request: TryOnRequestResponse) => void,
  { intervalMs = 800, timeoutMs = 30000, token }: { intervalMs?: number; timeoutMs?: number; token?: string | null } = {}
): Promise<TryOnRequestResponse> {
  const start = Date.now();
  for (;;) {
    const current = await getTryOnRequest(requestId, token);
    onUpdate(current);
    if (TERMINAL_STATUSES.has(current.status)) {
      return current;
    }
    if (Date.now() - start > timeoutMs) {
      throw new ApiError("Processing is taking longer than expected. Please try again.", 408);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// --- Milestone 4: geometry try-on rendering ---

export async function listTryOnCategories(): Promise<CategoryOptionResponse[]> {
  return request("/api/v1/tryon/categories");
}

export async function createTryOnRender(
  requestId: string,
  jewelleryId: string,
  token?: string | null
): Promise<TryOnRenderResponse> {
  return request(`/api/v1/tryon/requests/${requestId}/render`, {
    method: "POST",
    body: JSON.stringify({ jewellery_id: jewelleryId }),
    token,
  });
}

export async function getTryOnRender(renderId: string, token?: string | null): Promise<TryOnRenderResponse> {
  return request(`/api/v1/tryon/renders/${renderId}`, { token });
}

const RENDER_TERMINAL_STATUSES = new Set(["ready", "failed", "blocked"]);

/**
 * Polls GET /renders/{id} until a terminal status (`ready`/`failed`/`blocked`) — same
 * "no fabricated progress" discipline as pollTryOnRequest above.
 */
export async function pollTryOnRender(
  renderId: string,
  onUpdate: (render: TryOnRenderResponse) => void,
  { intervalMs = 800, timeoutMs = 30000, token }: { intervalMs?: number; timeoutMs?: number; token?: string | null } = {}
): Promise<TryOnRenderResponse> {
  const start = Date.now();
  for (;;) {
    const current = await getTryOnRender(renderId, token);
    onUpdate(current);
    if (RENDER_TERMINAL_STATUSES.has(current.status)) {
      return current;
    }
    if (Date.now() - start > timeoutMs) {
      throw new ApiError("Rendering is taking longer than expected. Please try again.", 408);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
