"use client";

import { usePathname } from "next/navigation";

import { JewelleryAIAssistant } from "@/components/jewellery-ai/JewelleryAIAssistant";

// /try-on/live already has a dense, camera-driven AR UI of its own (catalogue grid,
// "on the model" panel, capture controls) -- a floating assistant button there risks
// sitting on top of one of those, and the spec is explicit that it must never cover
// camera/model controls. Simplest safe rule: don't render it on that route at all;
// every other customer-facing page (home, categories, the photo-based /try-on flow)
// keeps it.
const HIDDEN_PATH_PREFIXES = ["/try-on/live"];

export function AssistantMount() {
  const pathname = usePathname();
  const hidden = HIDDEN_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
  if (hidden) return null;
  return <JewelleryAIAssistant />;
}
