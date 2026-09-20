import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import LandingPage from "@/app/page";

describe("Landing page", () => {
  it("renders the hero heading and a call to action into the Try-On Studio", () => {
    render(<LandingPage />);
    expect(
      screen.getByRole("heading", { name: /see the piece on you before it arrives/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /try/i }).length).toBeGreaterThan(0);
  });

  it("lists the jewellery categories", () => {
    render(<LandingPage />);
    // Each category is now a designed icon image, its label carried in real alt
    // text (accessible to screen readers) rather than a separate visible <span> --
    // see apps/web/public/category-icons.
    expect(screen.getByAltText("Earrings")).toBeInTheDocument();
    expect(screen.getByAltText("Necklaces")).toBeInTheDocument();
    expect(screen.getByAltText("Rings")).toBeInTheDocument();
  });
});
