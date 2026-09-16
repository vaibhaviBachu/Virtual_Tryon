import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { JewelleryList } from "@/components/admin/JewelleryList";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as catalogueApi from "@/lib/catalogue-api";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, listCategories: vi.fn(), listJewellery: vi.fn() };
});

const SAMPLE_CATEGORY = {
  id: "cat-1",
  name: "Earrings",
  slug: "earrings",
  description: null,
  anchor_type: "ear",
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
  name: "Gold Hoops",
  slug: "gold-hoops",
  description: null,
  sku: "SKU-1",
  price: null,
  currency: null,
  physical_width_mm: 20,
  physical_height_mm: 25,
  physical_depth_mm: null,
  weight_g: 5.2,
  extra_measurements: {},
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("JewelleryList", () => {
  it("renders items returned by the API with their real fields", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([SAMPLE_CATEGORY]);
    vi.mocked(catalogueApi.listJewellery).mockResolvedValue({
      items: [SAMPLE_ITEM],
      total: 1,
      page: 1,
      page_size: 10,
    });

    render(<JewelleryList />, { wrapper: TestQueryProvider });

    expect(await screen.findByText("Gold Hoops")).toBeInTheDocument();
    expect(screen.getByText("SKU-1")).toBeInTheDocument();
    expect(screen.getByText("20 × 25")).toBeInTheDocument();
  });

  it("shows an empty state when no items match the filters", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([SAMPLE_CATEGORY]);
    vi.mocked(catalogueApi.listJewellery).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 });

    render(<JewelleryList />, { wrapper: TestQueryProvider });
    expect(await screen.findByText(/no jewellery items match/i)).toBeInTheDocument();
  });

  it("passes the search term through to the API as a real query parameter", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([SAMPLE_CATEGORY]);
    vi.mocked(catalogueApi.listJewellery).mockResolvedValue({
      items: [SAMPLE_ITEM],
      total: 1,
      page: 1,
      page_size: 10,
    });

    const user = userEvent.setup();
    render(<JewelleryList />, { wrapper: TestQueryProvider });
    await screen.findByText("Gold Hoops");

    await user.type(screen.getByPlaceholderText(/search name or sku/i), "hoop");

    await waitFor(() =>
      expect(catalogueApi.listJewellery).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "hoop" })
      )
    );
  });

  it("surfaces a real error state when the API call fails", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([SAMPLE_CATEGORY]);
    vi.mocked(catalogueApi.listJewellery).mockRejectedValue(new catalogueApi.ApiError("Server error", 500));

    render(<JewelleryList />, { wrapper: TestQueryProvider });
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load jewellery/i);
  });
});
