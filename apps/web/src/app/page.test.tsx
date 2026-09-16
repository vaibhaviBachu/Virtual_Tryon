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
    expect(screen.getByText("Earrings")).toBeInTheDocument();
    expect(screen.getByText("Necklaces")).toBeInTheDocument();
    expect(screen.getByText("Rings")).toBeInTheDocument();
  });
});
