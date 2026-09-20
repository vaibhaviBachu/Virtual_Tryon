import { API_BASE_URL } from "@/lib/config";
import type {
  AssetResponse,
  AssetWithPreviewResponse,
  CategoryCreateInput,
  CategoryResponse,
  JewelleryCreateInput,
  JewelleryResponse,
  Page,
} from "@/lib/catalogue-types";

/**
 * Typed client for the Milestone 2 catalogue + auth API. Every function throws
 * `ApiError` on a non-2xx response with the server's own `detail`/`message` field, so
 * callers can show the real backend validation error rather than a generic failure —
 * per the "never fabricate a plausible-looking success/error" rule applied to the
 * frontend too.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.details) && body.details.length > 0) {
      return body.details.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ");
    }
    if (typeof body.message === "string") return body.message;
  } catch {
    // response body wasn't JSON — fall through to the generic message below
  }
  return `Request failed with status ${response.status}`;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
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
    throw new ApiError(await parseErrorDetail(response), response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// --- Auth ---

export async function login(email: string, password: string): Promise<{ access_token: string; token_type: string }> {
  return request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function getCurrentUser(token: string): Promise<{ id: string; email: string; role: string }> {
  return request("/api/v1/auth/me", { token });
}

// --- Categories ---

export async function listCategories(isActive?: boolean): Promise<CategoryResponse[]> {
  const query = isActive === undefined ? "" : `?is_active=${isActive}`;
  return request(`/api/v1/catalog/categories${query}`);
}

export async function createCategory(input: CategoryCreateInput, token: string): Promise<CategoryResponse> {
  return request("/api/v1/catalog/categories", { method: "POST", body: JSON.stringify(input), token });
}

// --- Jewellery ---

export interface ListJewelleryParams {
  categoryId?: string;
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listJewellery(params: ListJewelleryParams = {}): Promise<Page<JewelleryResponse>> {
  const query = new URLSearchParams();
  if (params.categoryId) query.set("category_id", params.categoryId);
  if (params.isActive !== undefined) query.set("is_active", String(params.isActive));
  if (params.search) query.set("search", params.search);
  query.set("page", String(params.page ?? 1));
  query.set("page_size", String(params.pageSize ?? 20));
  return request(`/api/v1/catalog/jewellery?${query.toString()}`);
}

export async function getJewellery(id: string): Promise<JewelleryResponse> {
  return request(`/api/v1/catalog/jewellery/${id}`);
}

export async function createJewellery(input: JewelleryCreateInput, token: string): Promise<JewelleryResponse> {
  return request("/api/v1/catalog/jewellery", { method: "POST", body: JSON.stringify(input), token });
}

export async function updateJewellery(
  id: string,
  input: Partial<JewelleryCreateInput>,
  token: string
): Promise<JewelleryResponse> {
  return request(`/api/v1/catalog/jewellery/${id}`, { method: "PATCH", body: JSON.stringify(input), token });
}

export async function archiveJewellery(id: string, token: string): Promise<JewelleryResponse> {
  return request(`/api/v1/catalog/jewellery/${id}`, { method: "DELETE", token });
}

// Genuinely removes the item (row, assets, and their storage files) -- distinct from
// archiveJewellery above, which only sets is_active=false and is reversible. See
// apps/api/v1/services/jewellery_service.py's delete_jewellery_permanently docstring:
// this also deletes any saved try-on captures/renders for this item.
export async function deleteJewelleryPermanently(id: string, token: string): Promise<void> {
  return request(`/api/v1/catalog/jewellery/${id}/permanent`, { method: "DELETE", token });
}

// --- Assets ---

export async function listAssets(jewelleryId: string): Promise<AssetResponse[]> {
  return request(`/api/v1/catalog/jewellery/${jewelleryId}/assets`);
}

export async function getAsset(assetId: string): Promise<AssetWithPreviewResponse> {
  return request(`/api/v1/catalog/assets/${assetId}`);
}

export async function uploadAsset(jewelleryId: string, file: File, token: string): Promise<AssetResponse[]> {
  const formData = new FormData();
  formData.append("file", file);
  return request(`/api/v1/catalog/jewellery/${jewelleryId}/assets`, {
    method: "POST",
    body: formData,
    token,
  });
}

export async function deleteAsset(assetId: string, token: string): Promise<void> {
  return request(`/api/v1/catalog/assets/${assetId}`, { method: "DELETE", token });
}
