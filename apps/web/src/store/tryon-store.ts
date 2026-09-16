import { create } from "zustand";

/**
 * The Try-On Studio state machine described in docs/architecture.md §3.
 *
 * Milestone 1 implements the state machine and its transitions with placeholder data
 * only — no real capture pipeline (Milestone 3), no real catalogue (Milestone 2), and no
 * real try-on rendering (Milestone 4) are wired in yet. Every transition function here
 * is what later milestones will call from real event handlers.
 */
export type StudioState =
  | "idle"
  | "capturing"
  | "previewing"
  | "selecting_category"
  | "selecting_item"
  | "processing"
  | "result"
  | "comparing";

export interface JewelleryCategoryOption {
  slug: string;
  displayName: string;
}

interface TryOnStoreState {
  state: StudioState;
  capturedImageUrl: string | null;
  selectedCategory: JewelleryCategoryOption | null;
  selectedItemId: string | null;

  startCapturing: () => void;
  setCapturedImage: (url: string) => void;
  selectCategory: (category: JewelleryCategoryOption) => void;
  selectItem: (itemId: string) => void;
  startProcessing: () => void;
  finishProcessing: () => void;
  startComparing: () => void;
  tryAnotherItem: () => void;
  reset: () => void;
}

const initialState = {
  state: "idle" as StudioState,
  capturedImageUrl: null,
  selectedCategory: null,
  selectedItemId: null,
};

export const useTryOnStore = create<TryOnStoreState>((set) => ({
  ...initialState,

  startCapturing: () => set({ state: "capturing" }),

  setCapturedImage: (url) =>
    set({ state: "previewing", capturedImageUrl: url }),

  selectCategory: (category) =>
    set({ state: "selecting_item", selectedCategory: category }),

  selectItem: (itemId) =>
    set({ state: "selecting_item", selectedItemId: itemId }),

  startProcessing: () => set({ state: "processing" }),

  finishProcessing: () => set({ state: "result" }),

  startComparing: () => set({ state: "comparing" }),

  tryAnotherItem: () =>
    set({ state: "selecting_category", selectedItemId: null }),

  reset: () => set({ ...initialState }),
}));
