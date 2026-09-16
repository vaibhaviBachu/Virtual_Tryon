import { create } from "zustand";

import type { ReadinessSummary, TryOnRenderStatus, TryOnRequestStatus } from "@/lib/tryon-types";

/**
 * The Try-On Studio state machine described in docs/architecture.md §3.
 *
 * Milestone 3 adds the real "analyzing" state (photo -> session -> upload -> request ->
 * poll -> readiness), replacing what was a pure UI placeholder in Milestone 1. Category/
 * item selection and the "processing"/"result" try-on-rendering states below remain
 * exactly as much of a placeholder as before — real jewellery placement is Milestone 4,
 * not this one; this milestone only understands the user's photo.
 */
export type StudioState =
  | "idle"
  | "capturing"
  | "previewing"
  | "analyzing"
  | "readiness"
  | "analysis_failed"
  | "selecting_category"
  | "selecting_item"
  | "processing"
  | "result"
  | "comparing";

export interface JewelleryCategoryOption {
  id: string;
  slug: string;
  displayName: string;
  // Milestone 4 (spec §26): real backend flag — only categories the geometry engine
  // actually supports ("earrings", "necklace") are functional; everything else is
  // shown disabled and must never trigger a render attempt.
  functional: boolean;
}

export interface JewelleryItemOption {
  id: string;
  name: string;
}

interface TryOnStoreState {
  state: StudioState;
  capturedImageUrl: string | null;
  selectedCategory: JewelleryCategoryOption | null;
  selectedItemId: string | null;

  // Milestone 3: real backend identifiers + the real, live analysis status/message —
  // never a fabricated progress percentage (see docs/roadmap.md's Milestone 3 rule).
  sessionId: string | null;
  userImageId: string | null;
  requestId: string | null;
  analysisStatusLabel: string | null;
  analysisStatus: TryOnRequestStatus | null;
  readiness: ReadinessSummary | null;
  analysisError: string | null;

  // Milestone 4: real category/item catalogue data + the real render lifecycle.
  categories: JewelleryCategoryOption[];
  items: JewelleryItemOption[];
  renderId: string | null;
  renderStatus: TryOnRenderStatus | null;
  renderStatusLabel: string | null;
  resultImageUrl: string | null;
  renderErrorCode: string | null;
  renderErrorMessage: string | null;

  startCapturing: () => void;
  setCapturedImage: (url: string) => void;
  setCategories: (categories: JewelleryCategoryOption[]) => void;
  selectCategory: (category: JewelleryCategoryOption) => void;
  setItems: (items: JewelleryItemOption[]) => void;
  selectItem: (itemId: string) => void;
  startProcessing: () => void;
  finishProcessing: () => void;
  startComparing: () => void;
  tryAnotherItem: () => void;
  reset: () => void;

  startAnalyzing: () => void;
  setAnalysisIds: (ids: { sessionId?: string; userImageId?: string; requestId?: string }) => void;
  setAnalysisStatus: (status: TryOnRequestStatus, label: string) => void;
  finishAnalyzingWithReadiness: (readiness: ReadinessSummary) => void;
  failAnalysis: (message: string) => void;

  startRendering: () => void;
  setRenderId: (renderId: string) => void;
  setRenderStatus: (status: TryOnRenderStatus, label: string) => void;
  finishRenderingWithResult: (resultImageUrl: string) => void;
  finishRenderingBlockedOrFailed: (errorCode: string | null, errorMessage: string) => void;
}

const initialState = {
  state: "idle" as StudioState,
  capturedImageUrl: null,
  selectedCategory: null,
  selectedItemId: null,
  sessionId: null,
  userImageId: null,
  requestId: null,
  analysisStatusLabel: null,
  analysisStatus: null,
  readiness: null,
  analysisError: null,
  categories: [] as JewelleryCategoryOption[],
  items: [] as JewelleryItemOption[],
  renderId: null,
  renderStatus: null,
  renderStatusLabel: null,
  resultImageUrl: null,
  renderErrorCode: null,
  renderErrorMessage: null,
};

export const useTryOnStore = create<TryOnStoreState>((set) => ({
  ...initialState,

  startCapturing: () => set({ state: "capturing" }),

  setCapturedImage: (url) =>
    set({ state: "previewing", capturedImageUrl: url }),

  setCategories: (categories) => set({ categories }),

  selectCategory: (category) =>
    set({ state: "selecting_item", selectedCategory: category, items: [], selectedItemId: null }),

  setItems: (items) => set({ items }),

  selectItem: (itemId) =>
    set({ state: "selecting_item", selectedItemId: itemId }),

  startProcessing: () => set({ state: "processing" }),

  finishProcessing: () => set({ state: "result" }),

  startComparing: () => set({ state: "comparing" }),

  tryAnotherItem: () =>
    set({
      state: "selecting_category",
      selectedItemId: null,
      renderId: null,
      renderStatus: null,
      renderStatusLabel: null,
      resultImageUrl: null,
      renderErrorCode: null,
      renderErrorMessage: null,
    }),

  reset: () => set({ ...initialState }),

  startAnalyzing: () =>
    set({ state: "analyzing", analysisError: null, analysisStatus: null, analysisStatusLabel: "Checking your photo…" }),

  setAnalysisIds: (ids) =>
    set((prev) => ({
      sessionId: ids.sessionId ?? prev.sessionId,
      userImageId: ids.userImageId ?? prev.userImageId,
      requestId: ids.requestId ?? prev.requestId,
    })),

  setAnalysisStatus: (status, label) => set({ analysisStatus: status, analysisStatusLabel: label }),

  finishAnalyzingWithReadiness: (readiness) => set({ state: "readiness", readiness }),

  failAnalysis: (message) => set({ state: "analysis_failed", analysisError: message }),

  startRendering: () =>
    set({
      state: "processing",
      renderId: null,
      renderStatus: null,
      renderStatusLabel: "Preparing your try-on…",
      resultImageUrl: null,
      renderErrorCode: null,
      renderErrorMessage: null,
    }),

  setRenderId: (renderId) => set({ renderId }),

  setRenderStatus: (status, label) => set({ renderStatus: status, renderStatusLabel: label }),

  finishRenderingWithResult: (resultImageUrl) =>
    set({ state: "result", renderStatus: "ready", resultImageUrl, renderErrorCode: null, renderErrorMessage: null }),

  finishRenderingBlockedOrFailed: (errorCode, errorMessage) =>
    set({ state: "result", renderErrorCode: errorCode, renderErrorMessage: errorMessage, resultImageUrl: null }),
}));
