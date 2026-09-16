import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import JewelleryDetailPage from "@/app/admin/catalogue/[id]/page";
import { useAdminAuthStore } from "@/store/admin-auth-store";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as catalogueApi from "@/lib/catalogue-api";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, getJewellery: vi.fn(), listAssets: vi.fn() };
});

const SAMPLE_CATEGORY = {
  id: "cat-1",
  name: "Ring",
  slug: "ring",
  description: null,
  anchor_type: "finger",
  placement_config: {},
  is_active: true,
  item_count: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const SAMPLE_ITEM = {
  id: "item-1",
  category_id: "cat-1",
  category: SAMPLE_CATEGORY,
  name: "Diamond Ring",
  slug: "diamond-ring",
  description: null,
  sku: "SKU-RING-1",
  price: null,
  currency: null,
  physical_width_mm: 18,
  physical_height_mm: 18,
  physical_depth_mm: 6,
  weight_g: 3.1,
  extra_measurements: {},
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("Jewellery detail page", () => {
  afterEach(() => {
    useAdminAuthStore.getState().clearSession();
  });

  it("shows the login form when there is no admin session", async () => {
    await act(async () => {
      render(
        <TestQueryProvider>
          <Suspense fallback="loading">
            <JewelleryDetailPage params={Promise.resolve({ id: "item-1" })} />
          </Suspense>
        </TestQueryProvider>
      );
    });
    expect(await screen.findByRole("heading", { name: /admin sign-in/i })).toBeInTheDocument();
  });

  it("shows real jewellery details and assets once authenticated", async () => {
    vi.mocked(catalogueApi.getJewellery).mockResolvedValue(SAMPLE_ITEM);
    vi.mocked(catalogueApi.listAssets).mockResolvedValue([]);
    useAdminAuthStore.getState().setSession("test-token", "admin@example.com", "admin");

    await act(async () => {
      render(
        <TestQueryProvider>
          <Suspense fallback="loading">
            <JewelleryDetailPage params={Promise.resolve({ id: "item-1" })} />
          </Suspense>
        </TestQueryProvider>
      );
    });

    expect(await screen.findByText("Diamond Ring")).toBeInTheDocument();
    expect(screen.getByText("SKU-RING-1")).toBeInTheDocument();
    expect(screen.getByText(/no photos uploaded yet/i)).toBeInTheDocument();
  });

  it("shows a real not-found state for an unknown jewellery id", async () => {
    vi.mocked(catalogueApi.getJewellery).mockRejectedValue(new catalogueApi.ApiError("Jewellery not found.", 404));
    vi.mocked(catalogueApi.listAssets).mockResolvedValue([]);
    useAdminAuthStore.getState().setSession("test-token", "admin@example.com", "admin");

    await act(async () => {
      render(
        <TestQueryProvider>
          <Suspense fallback="loading">
            <JewelleryDetailPage params={Promise.resolve({ id: "does-not-exist" })} />
          </Suspense>
        </TestQueryProvider>
      );
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/not found/i);
  });
});
