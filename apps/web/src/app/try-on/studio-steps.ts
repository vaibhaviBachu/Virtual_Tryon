import type { StudioState } from "@/store/tryon-store";

export const STUDIO_STEPS: { state: StudioState; label: string }[] = [
  { state: "idle", label: "Start" },
  { state: "capturing", label: "Photo" },
  { state: "analyzing", label: "Analyze" },
  { state: "selecting_category", label: "Category" },
  { state: "selecting_item", label: "Item" },
  { state: "processing", label: "Processing" },
  { state: "result", label: "Result" },
];

export function stepIndex(state: StudioState): number {
  // previewing counts as part of the "Photo" step; readiness/analysis_failed count as
  // part of "Analyze" (Milestone 3's real photo-understanding phase, distinct from the
  // later jewellery-rendering "Processing" step); comparing counts as part of "Result".
  const normalized =
    state === "previewing"
      ? "capturing"
      : state === "readiness" || state === "analysis_failed"
        ? "analyzing"
        : state === "comparing"
          ? "result"
          : state;
  return STUDIO_STEPS.findIndex((s) => s.state === normalized);
}
