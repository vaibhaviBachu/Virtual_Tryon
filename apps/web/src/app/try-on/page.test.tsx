import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TryOnStudioPage from "@/app/try-on/page";
import { useTryOnStore } from "@/store/tryon-store";
import * as tryonApi from "@/lib/tryon-api";
import * as catalogueApi from "@/lib/catalogue-api";

vi.mock("@/lib/tryon-api", async () => {
  const actual = await vi.importActual<typeof tryonApi>("@/lib/tryon-api");
  return {
    ...actual,
    listTryOnCategories: vi.fn(),
    createTryOnRender: vi.fn(),
    pollTryOnRender: vi.fn(),
  };
});

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, listJewellery: vi.fn() };
});

describe("Try-On Studio page", () => {
  afterEach(() => {
    useTryOnStore.getState().reset();
    vi.clearAllMocks();
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

  it("shows lightweight photo guidance while capturing", async () => {
    const user = userEvent.setup();
    render(<TryOnStudioPage />);
    await user.click(screen.getByRole("button", { name: /begin/i }));
    expect(screen.getByText(/keep your ears visible/i)).toBeInTheDocument();
  });

  it("requires review (Retake/Use this photo) before analysis starts — no auto-submit", () => {
    act(() => {
      useTryOnStore.setState({ state: "previewing", capturedImageUrl: "blob:fake" });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByRole("button", { name: /retake/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use this photo/i })).toBeInTheDocument();
  });

  it("shows the real backend status label while analyzing, never a fake percentage", () => {
    act(() => {
      useTryOnStore.setState({
        state: "analyzing",
        analysisStatusLabel: "Checking face, ears, and hands…",
      });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByText("Checking face, ears, and hands…")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("shows an actionable, non-technical message on analysis failure", () => {
    act(() => {
      useTryOnStore.setState({
        state: "analysis_failed",
        analysisError: "Your ears aren't clearly visible. Please move your hair away from your ears and take another photo.",
      });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByText(/move your hair away from your ears/i)).toBeInTheDocument();
    expect(screen.queryByText(/traceback|exception|stack/i)).not.toBeInTheDocument();
  });

  it("shows category-aware readiness (e.g. necklace ready, earrings not ready, from the same photo)", () => {
    act(() => {
      useTryOnStore.setState({
        state: "readiness",
        readiness: {
          face_ready: true,
          ears_ready: false,
          left_ear_ready: false,
          right_ear_ready: true,
          neck_ready: true,
          hands_ready: false,
          reasons: { ears: "One or both ears are not clearly visible." },
          raw_confidences: {},
        },
      });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByText(/neck and shoulders visible/i)).toBeInTheDocument();
    expect(screen.getByText(/one or both ears are not clearly visible/i)).toBeInTheDocument();
  });

  // --- Milestone 4: category selection, jewellery selection, render, processing, result ---

  it("fetches real categories and disables non-functional ones (never hard-coded)", async () => {
    vi.mocked(tryonApi.listTryOnCategories).mockResolvedValue([
      { id: "cat-earrings", slug: "earrings", name: "Earrings", functional: true },
      { id: "cat-ring", slug: "ring", name: "Ring", functional: false },
    ]);
    act(() => {
      useTryOnStore.setState({ state: "selecting_category" });
    });
    render(<TryOnStudioPage />);

    await waitFor(() => expect(screen.getByText("Earrings")).toBeInTheDocument());
    const ringButton = screen.getByRole("button", { name: /^ring/i });
    expect(ringButton).toBeDisabled();
    const earringsButton = screen.getByRole("button", { name: /^earrings/i });
    expect(earringsButton).not.toBeDisabled();
  });

  it("clicking a functional category loads real jewellery items for it", async () => {
    vi.mocked(catalogueApi.listJewellery).mockResolvedValue({
      items: [
        { id: "item-1", name: "Gold Studs" } as never,
        { id: "item-2", name: "Silver Hoops" } as never,
      ],
      total: 2,
      page: 1,
      page_size: 50,
    });
    act(() => {
      useTryOnStore.setState({
        state: "selecting_item",
        selectedCategory: { id: "cat-earrings", slug: "earrings", displayName: "Earrings", functional: true },
      });
    });
    render(<TryOnStudioPage />);

    await waitFor(() => expect(screen.getByText("Gold Studs")).toBeInTheDocument());
    expect(screen.getByText("Silver Hoops")).toBeInTheDocument();
    expect(catalogueApi.listJewellery).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: "cat-earrings" })
    );
  });

  it("selecting an item enables the real render button, and clicking it calls createTryOnRender/pollTryOnRender", async () => {
    vi.mocked(tryonApi.createTryOnRender).mockResolvedValue({
      id: "render-1", request_id: "req-1", jewellery_id: "item-1", asset_id: null,
      category_slug: "earrings", status: "queued", error_code: null, error_message: null,
      result_image_url: null, created_at: "", queued_at: null, started_at: null, completed_at: null,
    });
    vi.mocked(tryonApi.pollTryOnRender).mockResolvedValue({
      id: "render-1", request_id: "req-1", jewellery_id: "item-1", asset_id: "asset-1",
      category_slug: "earrings", status: "ready", error_code: null, error_message: null,
      result_image_url: "https://signed.example/result.png", created_at: "", queued_at: null,
      started_at: null, completed_at: null,
    });

    act(() => {
      useTryOnStore.setState({
        state: "selecting_item",
        requestId: "req-1",
        selectedItemId: "item-1",
        items: [{ id: "item-1", name: "Gold Studs" }],
        selectedCategory: { id: "cat-earrings", slug: "earrings", displayName: "Earrings", functional: true },
      });
    });
    render(<TryOnStudioPage />);

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /try this jewellery on/i });
    expect(button).not.toBeDisabled();
    await user.click(button);

    await waitFor(() => expect(tryonApi.createTryOnRender).toHaveBeenCalledWith("req-1", "item-1"));
    await waitFor(() => expect(useTryOnStore.getState().state).toBe("result"));
    expect(useTryOnStore.getState().resultImageUrl).toBe("https://signed.example/result.png");
  });

  it("shows the real render status label while processing, never a fake percentage", () => {
    act(() => {
      useTryOnStore.setState({ state: "processing", renderStatusLabel: "Placing the jewellery on your photo…" });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByText("Placing the jewellery on your photo…")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("result state shows the real generated image next to the original when ready", () => {
    act(() => {
      useTryOnStore.setState({
        state: "result",
        capturedImageUrl: "blob:original",
        resultImageUrl: "https://signed.example/result.png",
      });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByAltText("Try-on result")).toHaveAttribute("src", "https://signed.example/result.png");
    expect(screen.getByAltText("Original")).toHaveAttribute("src", "blob:original");
    // Never claims "100% realistic" (spec §45) — a disclaimer that it is NOT
    // photorealistic is fine (and present); a claim that it IS would not be.
    expect(screen.queryByText(/100% realistic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not a photorealistic/i)).toBeInTheDocument();
  });

  it("result state shows the real blocked/failed reason and no image when rendering could not proceed", () => {
    act(() => {
      useTryOnStore.setState({
        state: "result",
        resultImageUrl: null,
        renderErrorMessage: "Your ears aren't clearly visible in this photo.",
      });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByText(/ears aren't clearly visible/i)).toBeInTheDocument();
    expect(screen.queryByAltText("Try-on result")).not.toBeInTheDocument();
  });

  it("result state offers change jewellery and retake photo actions", () => {
    act(() => {
      useTryOnStore.setState({ state: "result", resultImageUrl: "https://signed.example/result.png" });
    });
    render(<TryOnStudioPage />);
    expect(screen.getByRole("button", { name: /change jewellery/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retake photo/i })).toBeInTheDocument();
  });
});
