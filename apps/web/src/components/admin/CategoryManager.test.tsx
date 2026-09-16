import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CategoryManager } from "@/components/admin/CategoryManager";
import { useAdminAuthStore } from "@/store/admin-auth-store";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as catalogueApi from "@/lib/catalogue-api";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, listCategories: vi.fn(), createCategory: vi.fn() };
});

const SAMPLE_CATEGORIES = [
  {
    id: "cat-1",
    name: "Earrings",
    slug: "earrings",
    description: null,
    anchor_type: "ear",
    placement_config: {},
    is_active: true,
    item_count: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

describe("CategoryManager", () => {
  afterEach(() => {
    useAdminAuthStore.getState().setSession("test-token", "admin@example.com", "admin");
    vi.clearAllMocks();
  });

  it("renders the seeded categories from the real API shape", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue(SAMPLE_CATEGORIES);
    render(<CategoryManager />, { wrapper: TestQueryProvider });

    expect(await screen.findByText(/earrings/i)).toBeInTheDocument();
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("submits a new category and shows the real validation error on failure", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue(SAMPLE_CATEGORIES);
    vi.mocked(catalogueApi.createCategory).mockRejectedValue(
      new catalogueApi.ApiError("A category with slug 'earrings' already exists.", 409)
    );

    const user = userEvent.setup();
    render(<CategoryManager />, { wrapper: TestQueryProvider });
    await screen.findByText(/earrings/i);

    await user.type(screen.getByPlaceholderText("Name"), "Earrings");
    await user.type(screen.getByPlaceholderText("slug_in_snake_case"), "earrings");
    await user.click(screen.getByRole("button", { name: /add category/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
  });

  it("clears the form and refetches on successful creation", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue(SAMPLE_CATEGORIES);
    vi.mocked(catalogueApi.createCategory).mockResolvedValue({
      ...SAMPLE_CATEGORIES[0],
      id: "cat-2",
      name: "Anklet",
      slug: "anklet",
      item_count: 0,
    });

    const user = userEvent.setup();
    render(<CategoryManager />, { wrapper: TestQueryProvider });
    await screen.findByText(/earrings/i);

    const nameInput = screen.getByPlaceholderText("Name") as HTMLInputElement;
    await user.type(nameInput, "Anklet");
    await user.type(screen.getByPlaceholderText("slug_in_snake_case"), "anklet");
    await user.click(screen.getByRole("button", { name: /add category/i }));

    await waitFor(() => expect(nameInput.value).toBe(""));
    expect(catalogueApi.createCategory).toHaveBeenCalledWith(
      { name: "Anklet", slug: "anklet", anchor_type: undefined },
      "test-token"
    );
  });
});
