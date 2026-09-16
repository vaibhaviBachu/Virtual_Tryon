import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AssetPreview } from "@/components/admin/AssetPreview";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as catalogueApi from "@/lib/catalogue-api";
import type { AssetResponse } from "@/lib/catalogue-types";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, getAsset: vi.fn() };
});

const BASE_ASSET: AssetResponse = {
  id: "asset-1",
  jewellery_id: "item-1",
  asset_type: "processed",
  mime_type: null,
  width_px: null,
  height_px: null,
  file_size_bytes: null,
  processing_status: "pending",
  processing_error: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("AssetPreview", () => {
  it("shows a real ready image with its signed preview URL", async () => {
    vi.mocked(catalogueApi.getAsset).mockResolvedValue({
      ...BASE_ASSET,
      processing_status: "ready",
      mime_type: "image/png",
      preview_url: "https://storage.test/signed-url",
    });

    render(<AssetPreview asset={{ ...BASE_ASSET, processing_status: "ready" }} />, { wrapper: TestQueryProvider });

    const img = await screen.findByRole("img", { name: /processed preview/i });
    expect(img).toHaveAttribute("src", "https://storage.test/signed-url");
  });

  it("shows the real processing_error on a failed asset, not a generic message", async () => {
    vi.mocked(catalogueApi.getAsset).mockResolvedValue({
      ...BASE_ASSET,
      processing_status: "failed",
      processing_error: "Automatic background removal failed for this image.",
      preview_url: null,
    });

    render(<AssetPreview asset={{ ...BASE_ASSET, processing_status: "failed" }} />, { wrapper: TestQueryProvider });

    expect(await screen.findByRole("alert")).toHaveTextContent(/background removal failed/i);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a Processing state while pending, distinct from ready/failed", async () => {
    vi.mocked(catalogueApi.getAsset).mockResolvedValue({ ...BASE_ASSET, preview_url: null });
    render(<AssetPreview asset={BASE_ASSET} />, { wrapper: TestQueryProvider });
    expect(await screen.findByText(/processing/i)).toBeInTheDocument();
  });
});
