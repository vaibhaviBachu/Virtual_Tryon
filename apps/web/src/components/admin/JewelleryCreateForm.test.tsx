import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { JewelleryCreateForm } from "@/components/admin/JewelleryCreateForm";
import { useAdminAuthStore } from "@/store/admin-auth-store";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as catalogueApi from "@/lib/catalogue-api";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, listCategories: vi.fn(), createJewellery: vi.fn() };
});

const SAMPLE_CATEGORY = {
  id: "cat-1",
  name: "Earrings",
  slug: "earrings",
  description: null,
  anchor_type: "ear",
  placement_config: {},
  is_active: true,
  item_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("JewelleryCreateForm", () => {
  afterEach(() => {
    useAdminAuthStore.getState().setSession("test-token", "admin@example.com", "admin");
    vi.clearAllMocks();
  });

  it("blocks submission client-side for an invalid slug, without calling the API", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([SAMPLE_CATEGORY]);
    const user = userEvent.setup();
    render(<JewelleryCreateForm />, { wrapper: TestQueryProvider });

    await screen.findByRole("option", { name: "Earrings" });
    await user.selectOptions(screen.getByRole("combobox"), "cat-1");
    await user.type(screen.getByPlaceholderText("Name"), "Bad Item");
    await user.type(screen.getByPlaceholderText("slug-in-kebab-case"), "Not A Valid Slug");
    await user.type(screen.getByPlaceholderText("SKU"), "SKU-1");
    await user.click(screen.getByRole("button", { name: /create jewellery item/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/lowercase letters, numbers, and hyphens/i);
    expect(catalogueApi.createJewellery).not.toHaveBeenCalled();
  });

  it("submits with real physical dimensions and shows a success message", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([SAMPLE_CATEGORY]);
    vi.mocked(catalogueApi.createJewellery).mockResolvedValue({
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
    });

    const user = userEvent.setup();
    render(<JewelleryCreateForm />, { wrapper: TestQueryProvider });

    await screen.findByRole("option", { name: "Earrings" });
    await user.selectOptions(screen.getByRole("combobox"), "cat-1");
    await user.type(screen.getByPlaceholderText("Name"), "Gold Hoops");
    await user.type(screen.getByPlaceholderText("slug-in-kebab-case"), "gold-hoops");
    await user.type(screen.getByPlaceholderText("SKU"), "SKU-1");
    await user.type(screen.getByPlaceholderText("Width (mm)"), "20");
    await user.type(screen.getByPlaceholderText("Height (mm)"), "25");
    await user.type(screen.getByPlaceholderText("Weight (g)"), "5.2");
    await user.click(screen.getByRole("button", { name: /create jewellery item/i }));

    await waitFor(() =>
      expect(catalogueApi.createJewellery).toHaveBeenCalledWith(
        expect.objectContaining({
          category_id: "cat-1",
          name: "Gold Hoops",
          slug: "gold-hoops",
          sku: "SKU-1",
          physical_width_mm: 20,
          physical_height_mm: 25,
          weight_g: 5.2,
        }),
        "test-token"
      )
    );
    expect(await screen.findByText(/created "gold hoops"/i)).toBeInTheDocument();
  });
});
