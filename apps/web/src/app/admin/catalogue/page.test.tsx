import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import AdminCataloguePage from "@/app/admin/catalogue/page";
import { useAdminAuthStore } from "@/store/admin-auth-store";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as catalogueApi from "@/lib/catalogue-api";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, listCategories: vi.fn(), listJewellery: vi.fn() };
});

describe("Admin catalogue page", () => {
  afterEach(() => {
    useAdminAuthStore.getState().clearSession();
  });

  it("shows the login form when there is no admin session", () => {
    render(<AdminCataloguePage />, { wrapper: TestQueryProvider });
    expect(screen.getByRole("heading", { name: /admin sign-in/i })).toBeInTheDocument();
    expect(screen.queryByText(/add jewellery item/i)).not.toBeInTheDocument();
  });

  it("shows catalogue management sections once an admin session exists", async () => {
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([]);
    vi.mocked(catalogueApi.listJewellery).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
    useAdminAuthStore.getState().setSession("test-token", "admin@example.com", "admin");

    render(<AdminCataloguePage />, { wrapper: TestQueryProvider });

    expect(screen.getByText(/add jewellery item/i)).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /admin sign-in/i })).not.toBeInTheDocument();
  });
});
