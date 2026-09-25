/**
 * Phase D Step 3 — the category strategy contract. Every strategy composes the SAME
 * shared primitives (`primitives.ts`)/materials (`materials.ts`) into a
 * `JewelleryComponent` tree; none of them are allowed to create `THREE.BufferGeometry`
 * directly with their own one-off math -- that would be exactly the
 * per-category-duplicated mesh logic Phase D explicitly forbids.
 */
import type { Jewellery3DSpecification, JewelleryCategory, JewelleryComponent } from "@/lib/jewellery-3d-generator/types";

export interface JewelleryCategoryStrategy {
  category: JewelleryCategory;
  buildComponentTree(spec: Jewellery3DSpecification): JewelleryComponent;
}
