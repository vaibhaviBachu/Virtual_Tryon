/**
 * Phase D Step 3/17 — the category strategy registry. This is the literal proof of
 * the architecture-quality gate ("if the vault receives 1,000 new designs, would we
 * need a new geometry generator for each one? Must be NO"): adding a 10th category
 * (e.g. "bangle") is registering one more strategy file here, reusing every existing
 * primitive/material/component/export module untouched -- never a new rendering
 * pipeline.
 */
import { necklaceStrategy } from "@/lib/jewellery-3d-generator/strategies/necklace-strategy";
import { ringStrategy } from "@/lib/jewellery-3d-generator/strategies/ring-strategy";
import type { JewelleryCategoryStrategy } from "@/lib/jewellery-3d-generator/strategies/types";
import type { JewelleryCategory } from "@/lib/jewellery-3d-generator/types";

/** Registered today: exactly the two categories Phase D's own stop condition asks us
 * to validate. `haaram`/`earring`/`bangle`/`bracelet`/`maang_tikka`/`nose_ring`/
 * `jewellery_set` are real values of the `JewelleryCategory` union (so specifications
 * for them are already type-checkable) but have no strategy registered yet -- see
 * `docs/procedural-jewellery-system.md` for how each of those would compose the same
 * primitives already used by necklace/ring. */
const strategies = new Map<JewelleryCategory, JewelleryCategoryStrategy>([
  ["necklace", necklaceStrategy],
  ["ring", ringStrategy],
]);

export function getCategoryStrategy(category: JewelleryCategory): JewelleryCategoryStrategy {
  const strategy = strategies.get(category);
  if (!strategy) {
    throw new Error(`No 3D generation strategy is registered yet for category "${category}". Implemented: ${Array.from(strategies.keys()).join(", ")}.`);
  }
  return strategy;
}

export function listImplementedCategories(): JewelleryCategory[] {
  return Array.from(strategies.keys());
}
