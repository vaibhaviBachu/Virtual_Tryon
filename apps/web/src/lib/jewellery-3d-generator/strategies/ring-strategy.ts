/**
 * Phase D Step 3/11 — ring category strategy. Deliberately exercises a DIFFERENT
 * geometry topology than the necklace strategy (a CLOSED curve, not an open arc) to
 * prove the shared primitives generalize -- see this module's file docstring in
 * `primitives.ts` and Phase D Step 11's own requirement ("Ring/Bangle -> SAME generic
 * system").
 *
 * A ring's "setting" (Phase D Step 1's "stone setting, stone position") is composed
 * from the EXACT SAME fields as a necklace's pendant (`PendantSpec`'s
 * `positionOnCurve`/`forwardOffsetMm`/`gem`) -- a ring's central stone IS a pendant in
 * this system's terms, just on a closed loop instead of an open one. This is not a
 * coincidence; it is the direct proof that one shared shape (curve + cross-section +
 * an optional raised boss + gem) covers two visually very different jewellery types.
 * A bangle's repeated decorative segments would reuse this same strategy's radial
 * `repeatingElements` handling below, unchanged.
 */
import { buildJewelleryCurve } from "@/lib/jewellery-3d-generator/curves";
import { computeBandFrameAt, createBossGeometry, createFacetedGemGeometry, createRoundedGemGeometry, createSweptBandGeometry, evenlySpacedClosedCurveParams } from "@/lib/jewellery-3d-generator/primitives";
import type { JewelleryCategoryStrategy } from "@/lib/jewellery-3d-generator/strategies/types";
import type { GemSpec, Jewellery3DSpecification, JewelleryComponent } from "@/lib/jewellery-3d-generator/types";

function buildGemComponent(gem: GemSpec, name: string): JewelleryComponent {
  const geometry = gem.shape === "faceted" ? createFacetedGemGeometry(gem.widthMm, gem.heightMm, gem.depthMm) : createRoundedGemGeometry(gem.widthMm, gem.heightMm, gem.depthMm);
  return { name, geometry, materialId: gem.materialId, position: gem.positionLocal, children: [] };
}

export const ringStrategy: JewelleryCategoryStrategy = {
  category: "ring",

  buildComponentTree(spec: Jewellery3DSpecification): JewelleryComponent {
    if (!spec.band || spec.band.curve.kind !== "closed") {
      throw new Error(`Ring/bangle-family specification "${spec.id}" requires a CLOSED "band" curve.`);
    }
    const band = spec.band;
    const curve = buildJewelleryCurve(band.curve);
    const halfBandDepth = band.crossSection.depthMm / 2;

    const children: JewelleryComponent[] = [
      {
        name: "band",
        geometry: createSweptBandGeometry(band),
        materialId: band.materialId,
        position: { x: 0, y: 0, z: 0 },
        children: [],
      },
    ];

    if (spec.pendant) {
      const setting = spec.pendant;
      const frame = computeBandFrameAt(curve, setting.positionOnCurve, band.upAxis);
      const pos = frame.center.clone().addScaledVector(frame.depthDir, setting.forwardOffsetMm);
      const settingChildren: JewelleryComponent[] = setting.gem ? [buildGemComponent(setting.gem, "setting-gem")] : [];
      children.push({
        name: "setting",
        geometry: createBossGeometry(setting.widthMm, setting.heightMm, setting.depthMm),
        materialId: setting.materialId,
        position: { x: pos.x, y: pos.y, z: pos.z },
        children: settingChildren,
      });
    }

    for (const [elementIndex, element] of (spec.repeatingElements ?? []).entries()) {
      if (element.placement !== "radial") continue; // a ring/bangle's ornaments wrap radially, never "linear"
      const params = evenlySpacedClosedCurveParams(element.count);
      const groupChildren: JewelleryComponent[] = params.map((t, i) => {
        const frame = computeBandFrameAt(curve, t, band.upAxis);
        const offset = halfBandDepth + element.elementSizeMm.depthMm / 2;
        const origin = frame.center.clone().addScaledVector(frame.depthDir, offset);
        return {
          name: `${element.kind}-${i}`,
          geometry: createFacetedGemGeometry(element.elementSizeMm.widthMm, element.elementSizeMm.heightMm, element.elementSizeMm.depthMm),
          materialId: element.materialId,
          position: { x: origin.x, y: origin.y, z: origin.z },
          children: [],
        };
      });
      children.push({ name: `repeating-elements-${elementIndex}`, geometry: null, materialId: null, position: { x: 0, y: 0, z: 0 }, children: groupChildren });
    }

    for (const [gemIndex, gem] of (spec.gems ?? []).entries()) {
      children.push(buildGemComponent(gem, `accent-gem-${gemIndex}`));
    }

    return { name: "root", geometry: null, materialId: null, position: { x: 0, y: 0, z: 0 }, children };
  },
};
