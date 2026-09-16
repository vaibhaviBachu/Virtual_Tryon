import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TryOnStudioPage from "@/app/try-on/page";
import { useTryOnStore } from "@/store/tryon-store";

describe("Try-On Studio page", () => {
  afterEach(() => {
    useTryOnStore.getState().reset();
  });

  it("starts in the idle state with a Begin button", () => {
    render(<TryOnStudioPage />);
    expect(screen.getByRole("heading", { name: /try-on studio/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /begin/i })).toBeInTheDocument();
  });

  it("moves to the capturing state (upload fallback) after clicking Begin", async () => {
    const user = userEvent.setup();
    render(<TryOnStudioPage />);
    await user.click(screen.getByRole("button", { name: /begin/i }));
    expect(screen.getByRole("button", { name: /upload a photo instead/i })).toBeInTheDocument();
  });
});
