import { API_BASE_URL } from "@/lib/config";

/**
 * Minimal typed fetch wrapper. Milestone 1 only needs it for the health check on the
 * landing page's "system status" indicator; Milestone 2+ will add catalog/upload/tryon
 * calls here rather than scattering `fetch(...)` calls through components.
 */
export async function apiHealthCheck(): Promise<{
  ok: boolean;
  status?: string;
}> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      cache: "no-store",
    });
    if (!response.ok) return { ok: false };
    const body = await response.json();
    return { ok: true, status: body.status };
  } catch {
    return { ok: false };
  }
}
