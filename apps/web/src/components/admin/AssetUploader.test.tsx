import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AssetUploader } from "@/components/admin/AssetUploader";
import { useAdminAuthStore } from "@/store/admin-auth-store";
import { TestQueryProvider } from "@/test-utils/query-client-wrapper";
import * as catalogueApi from "@/lib/catalogue-api";
import type { AssetResponse } from "@/lib/catalogue-types";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, uploadAsset: vi.fn() };
});

function makeFile(name = "photo.jpg", type = "image/jpeg") {
  return new File(["fake-bytes"], name, { type });
}

describe("AssetUploader", () => {
  afterEach(() => {
    useAdminAuthStore.getState().setSession("test-token", "admin@example.com", "admin");
    vi.clearAllMocks();
  });

  it("shows the real uploaded state after a successful upload — no fake progress bar", async () => {
    let resolveUpload: (value: AssetResponse[]) => void = () => {};
    vi.mocked(catalogueApi.uploadAsset).mockImplementation(
      () => new Promise<AssetResponse[]>((resolve) => (resolveUpload = resolve))
    );

    const user = userEvent.setup();
    render(<AssetUploader jewelleryId="item-1" />, { wrapper: TestQueryProvider });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile());

    expect(await screen.findByText(/uploading/i)).toBeInTheDocument();

    resolveUpload([]);
    expect(await screen.findByText(/uploaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/uploading/i)).not.toBeInTheDocument();
  });

  it("shows the real backend error message on a rejected upload", async () => {
    vi.mocked(catalogueApi.uploadAsset).mockRejectedValue(
      new catalogueApi.ApiError("Unsupported image format (detected: unknown). Supported formats: JPEG, PNG, WebP.", 422)
    );

    const user = userEvent.setup();
    render(<AssetUploader jewelleryId="item-1" />, { wrapper: TestQueryProvider });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // The <input accept="image/jpeg,..."> attribute means userEvent.upload silently
    // drops a file whose MIME type doesn't match — that's a browser-level input filter,
    // not something this test is exercising. The real "wrong content" rejection is the
    // server's content-sniffing (ai/preprocessing/image_validation.py), already covered
    // by a real end-to-end test against the live API; here we're only proving the
    // component surfaces whatever error the server returns.
    await user.upload(input, makeFile("photo.jpg", "image/jpeg"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/unsupported image format/i);
  });
});
