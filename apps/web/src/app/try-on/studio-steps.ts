import type { StudioState } from "@/store/tryon-store";

export const STUDIO_STEPS: { state: StudioState; label: string }[] = [
  { state: "idle", label: "Start" },
  { state: "capturing", label: "Photo" },
  { state: "selecting_category", label: "Category" },
  { state: "selecting_item", label: "Item" },
  { state: "processing", label: "Processing" },
  { state: "result", label: "Result" },
];

export function stepIndex(state: StudioState): number {
  // previewing counts as part of the "Photo" step, comparing as part of "Result".
  const normalized = state === "previewing" ? "capturing" : state === "comparing" ? "result" : state;
  return STUDIO_STEPS.findIndex((s) => s.state === normalized);
}
