import { API_BASE_URL } from "@/lib/config";
import { ApiError } from "@/lib/catalogue-api";
import type { IntakeMetadata, IntakeResponse, SubmitResponse } from "@/lib/jewellery-ai-types";

/**
 * Typed client for the AI Jewellery Assistant API (apps/api/v1/routers/jewellery_ai.py).
 * Every route is public (no token parameter anywhere here) — see that router's
 * docstring for why. Reuses ApiError from catalogue-api.ts rather than redefining it,
 * so every part of the app surfaces the same real backend error shape.
 */
async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // not JSON — fall through
  }
  return `Request failed with status ${response.status}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorDetail(response), response.status);
  }
  return response.json() as Promise<T>;
}

export async function createIntakeSession(): Promise<IntakeResponse> {
  return request("/api/v1/jewellery-ai/sessions", { method: "POST" });
}

export async function getIntakeSession(sessionId: string): Promise<IntakeResponse> {
  return request(`/api/v1/jewellery-ai/sessions/${sessionId}`);
}

export async function uploadIntakeImage(sessionId: string, file: File): Promise<IntakeResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request(`/api/v1/jewellery-ai/sessions/${sessionId}/image`, { method: "POST", body: formData });
}

export async function regenerateIntakeImage(sessionId: string): Promise<IntakeResponse> {
  return request(`/api/v1/jewellery-ai/sessions/${sessionId}/regenerate`, { method: "POST" });
}

export async function suggestIntakeMetadata(sessionId: string): Promise<IntakeResponse> {
  return request(`/api/v1/jewellery-ai/sessions/${sessionId}/metadata`, { method: "POST" });
}

export async function updateIntakeMetadata(
  sessionId: string,
  patch: Partial<IntakeMetadata>
): Promise<IntakeResponse> {
  return request(`/api/v1/jewellery-ai/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function submitIntake(sessionId: string): Promise<SubmitResponse> {
  return request(`/api/v1/jewellery-ai/sessions/${sessionId}/submit`, { method: "POST" });
}

export { ApiError };
