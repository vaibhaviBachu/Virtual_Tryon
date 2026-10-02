import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { JewelleryAIAssistant } from "@/components/jewellery-ai/JewelleryAIAssistant";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as jewelleryAiApi from "@/lib/jewellery-ai-api";
import * as catalogueApi from "@/lib/catalogue-api";
import type { IntakeResponse } from "@/lib/jewellery-ai-types";

vi.mock("@/lib/jewellery-ai-api", async () => {
  const actual = await vi.importActual<typeof jewelleryAiApi>("@/lib/jewellery-ai-api");
  return {
    ...actual,
    createIntakeSession: vi.fn(),
    getIntakeSession: vi.fn(),
    uploadIntakeImage: vi.fn(),
    regenerateIntakeImage: vi.fn(),
    suggestIntakeMetadata: vi.fn(),
    updateIntakeMetadata: vi.fn(),
    submitIntake: vi.fn(),
  };
});

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, listCategories: vi.fn() };
});

const baseIntake: IntakeResponse = {
  id: "intake-1",
  status: "created",
  content_hash: null,
  original_preview_url: null,
  prepared_preview_url: null,
  ai_image_enhanced: false,
  image_preparation_status: "not_configured",
  image_generation_attempts: 0,
  suggested_metadata: {},
  user_metadata: {},
  duplicate_of_jewellery_id: null,
  jewellery_id: null,
  error_message: null,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};

function makeFile(name = "necklace.jpg") {
  return new File(["fake-bytes"], name, { type: "image/jpeg" });
}

describe("JewelleryAIAssistant", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(catalogueApi.listCategories).mockResolvedValue([
      {
        id: "cat-1",
        name: "Haaram",
        slug: "haaram",
        description: null,
        anchor_type: "neck",
        placement_config: {},
        is_active: true,
        item_count: 0,
        created_at: "2026-10-02T00:00:00Z",
        updated_at: "2026-10-02T00:00:00Z",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("walks through upload -> comparison -> details -> success end to end", async () => {
    const user = userEvent.setup();
    vi.mocked(jewelleryAiApi.createIntakeSession).mockResolvedValue(baseIntake);
    vi.mocked(jewelleryAiApi.uploadIntakeImage).mockResolvedValue({
      ...baseIntake,
      status: "image_ready",
      original_preview_url: "https://example.com/original.png",
      prepared_preview_url: "https://example.com/prepared.png",
    });
    vi.mocked(jewelleryAiApi.suggestIntakeMetadata).mockRejectedValue(
      new jewelleryAiApi.ApiError("AI service is not configured.", 503)
    );
    vi.mocked(jewelleryAiApi.updateIntakeMetadata).mockImplementation(async (_id, patch) => ({
      ...baseIntake,
      status: "image_ready",
      user_metadata: { ...patch },
    }));
    vi.mocked(jewelleryAiApi.submitIntake).mockResolvedValue({
      jewellery_id: "jewellery-1",
      intake: {
        ...baseIntake,
        status: "submitted",
        jewellery_id: "jewellery-1",
        user_metadata: { name: "Test Haaram", category_slug: "haaram" },
        prepared_preview_url: "https://example.com/prepared.png",
      },
    });

    render(<JewelleryAIAssistant />, { wrapper: TestQueryProvider });

    await user.click(screen.getByRole("button", { name: /open jewellery ai assistant/i }));
    expect(await screen.findByText(/upload a photo of your jewellery/i)).toBeInTheDocument();

    const fileInput = screen.getByLabelText(/upload a jewellery photo/i);
    await user.upload(fileInput, makeFile());

    expect(await screen.findByText(/your jewellery image is ready/i)).toBeInTheDocument();
    expect(jewelleryAiApi.uploadIntakeImage).toHaveBeenCalledWith("intake-1", expect.any(File));

    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/ai service is not configured/i)).toBeInTheDocument();

    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.type(nameInput, "Test Haaram");
    await user.tab();

    const categorySelect = screen.getByLabelText(/category/i);
    await user.selectOptions(categorySelect, "haaram");

    const submitButton = screen.getByRole("button", { name: /add to jewellery catalogue/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    expect(await screen.findByText(/added successfully/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /try it on/i })).toHaveAttribute("href", "/try-on/live");
  });

  it("shows an unfinished-work indicator after closing mid-flow and resuming", async () => {
    const user = userEvent.setup();
    vi.mocked(jewelleryAiApi.createIntakeSession).mockResolvedValue(baseIntake);
    vi.mocked(jewelleryAiApi.uploadIntakeImage).mockResolvedValue({
      ...baseIntake,
      status: "image_ready",
    });
    vi.mocked(jewelleryAiApi.getIntakeSession).mockResolvedValue({ ...baseIntake, status: "image_ready" });

    render(<JewelleryAIAssistant />, { wrapper: TestQueryProvider });
    await user.click(screen.getByRole("button", { name: /open jewellery ai assistant/i }));
    await user.upload(screen.getByLabelText(/upload a jewellery photo/i), makeFile());
    await screen.findByText(/your jewellery image is ready/i);

    await user.click(screen.getByRole("button", { name: /close assistant/i }));

    // The button is back, and since there's unfinished work (status != submitted) it
    // carries the indicator -- a real "you're mid-flow" signal, not a fabricated badge.
    expect(await screen.findByRole("button", { name: /open jewellery ai assistant/i })).toBeInTheDocument();
    expect(document.querySelector("span.absolute")).toBeInTheDocument();
  });
});
