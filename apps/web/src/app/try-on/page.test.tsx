import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
});
