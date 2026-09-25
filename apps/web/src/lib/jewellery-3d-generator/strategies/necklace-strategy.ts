/**
 * Phase D Step 3 — necklace-family category strategy (necklace / choker / haaram all
 * map onto this ONE strategy -- see types.ts's file docstring; only the
 * specification's own numbers differ, e.g. a haaram is the same shape with a longer
 * curve and more repeating tiers). Composes the shared band/boss/drop/gem primitives
 * -- writes zero geometry math of its own.
 */
import { buildJewelleryCurve } from "@/lib/jewellery-3d-generator/curves";
import {
  computeBandFrameAt,
  computeGraduatedLengths,
  createBossGeometry,
  createDropGeometry,
  createFacetedGemGeometry,
  createRoundedGemGeometry,
  createSweptBandGeometry,
  evenlySpacedOpenCurveParams,
} from "@/lib/jewellery-3d-generator/primitives";
import type { JewelleryCategoryStrategy } from "@/lib/jewellery-3d-generator/strategies/types";
import type { GemSpec, Jewellery3DSpecification, JewelleryComponent } from "@/lib/jewellery-3d-generator/types";

function buildGemComponent(gem: GemSpec, name: string): JewelleryComponent {
  const geometry = gem.shape === "faceted" ? createFacetedGemGeometry(gem.widthMm, gem.heightMm, gem.depthMm) : createRoundedGemGeometry(gem.widthMm, gem.heightMm, gem.depthMm);
  return { name, geometry, materialId: gem.materialId, position: gem.positionLocal, children: [] };
}

export const necklaceStrategy: JewelleryCategoryStrategy = {
  category: "necklace",

  buildComponentTree(spec: Jewellery3DSpecification): JewelleryComponent {
    if (!spec.band) {
      throw new Error(`Necklace/haaram-family specification "${spec.id}" requires a "band".`);
    }
    const band = spec.band;
    const curve = buildJewelleryCurve(band.curve);
    const halfBandWidth = band.crossSection.widthMm / 2;

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
      const pendant = spec.pendant;
      const frame = computeBandFrameAt(curve, pendant.positionOnCurve, band.upAxis);
      const pos = frame.center.clone().addScaledVector(frame.depthDir, pendant.forwardOffsetMm);
      const pendantChildren: JewelleryComponent[] = pendant.gem ? [buildGemComponent(pendant.gem, "pendant-gem")] : [];
      children.push({
        name: "pendant",
        geometry: createBossGeometry(pendant.widthMm, pendant.heightMm, pendant.depthMm),
        materialId: pendant.materialId,
        position: { x: pos.x, y: pos.y, z: pos.z },
        children: pendantChildren,
      });
    }

    for (const [elementIndex, element] of (spec.repeatingElements ?? []).entries()) {
      const params = evenlySpacedOpenCurveParams(element.count);
      const heights = element.graduated
        ? computeGraduatedLengths(element.count, element.graduated.shortestMm, element.graduated.longestMm)
        : Array.from({ length: element.count }, () => element.elementSizeMm.heightMm);

      const groupChildren: JewelleryComponent[] = params.map((t, i) => {
        const frame = computeBandFrameAt(curve, t, band.upAxis);
        const heightMm = heights[i];
        // Hang the element from the band's bottom edge: offset along widthDir (the
        // band's own "up" direction) by the half-band-width to reach the edge, then
        // by half the element's own height so its attachment point (not its center)
        // touches that edge -- see primitives.ts's createDropGeometry doc comment
        // for why the cone's apex (attachment point) is at local +Y.
        const origin = frame.center.clone().addScaledVector(frame.widthDir, -(halfBandWidth + heightMm / 2));
        const geometry =
          element.kind === "drop"
            ? createDropGeometry(element.elementSizeMm.widthMm, heightMm, element.elementSizeMm.depthMm)
            : createFacetedGemGeometry(element.elementSizeMm.widthMm, heightMm, element.elementSizeMm.depthMm);
        return {
          name: `${element.kind}-${i}`,
          geometry,
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
