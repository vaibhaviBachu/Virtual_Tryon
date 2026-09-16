import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import AdminPlaceholderPage from "@/app/admin/page";

describe("Admin placeholder page", () => {
  it("renders and clearly marks features as not implemented", () => {
    render(<AdminPlaceholderPage />);
    expect(screen.getByRole("heading", { name: /admin/i })).toBeInTheDocument();
    expect(screen.getByText(/not implemented yet/i)).toBeInTheDocument();
    expect(screen.getByText("Catalogue management")).toBeInTheDocument();
  });
});
