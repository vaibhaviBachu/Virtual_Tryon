/**
 * Phase D Step 11 — the SECOND validation asset, deliberately a different geometry
 * topology (a closed loop, not an open arc) from the Diamond Choker. This is a
 * SYNTHETIC architecture-validation fixture -- there is no real ring in the
 * catalogue vault behind these numbers (unlike the Diamond Choker, which adapts a
 * real reference asset's own measured proportions). It exists purely to prove
 * `ringStrategy` produces valid, real 3D geometry through the SAME generic pipeline
 * as the necklace strategy -- never to be presented as, or confused with, a real
 * catalogue item.
 */
import type { Jewellery3DSpecification } from "@/lib/jewellery-3d-generator/types";

const GOLD_MATERIAL_ID = "gold";
const DIAMOND_MATERIAL_ID = "diamond";

const INNER_RADIUS_MM = 8;
const OUTER_RADIUS_MM = 9.6;
const BAND_AXIAL_HEIGHT_MM = 2.2;

export function buildRingSpecification(): Jewellery3DSpecification {
  const centerlineRadiusMm = (INNER_RADIUS_MM + OUTER_RADIUS_MM) / 2;
  const radialThicknessMm = OUTER_RADIUS_MM - INNER_RADIUS_MM;

  return {
    id: "synthetic-ring-validation-fixture",
    category: "ring",
    status: "synthetic_validation_fixture",
    provenanceNote:
      "SYNTHETIC ARCHITECTURE-VALIDATION FIXTURE. Not a real catalogue item -- these " +
      "dimensions are invented purely to exercise the generic procedural 3D system's " +
      "closed-curve topology (Phase D Step 11). Must never be written to the " +
      "database or presented as a real jewellery item.",
    // heightMm is an approximate target -- the setting boss (height 4mm, centered at
    // the same y=0 as the band) dominates the band's own smaller axial height, so the
    // assembled bounding box comes out close to the boss's own height, not their sum.
    dimensions: { widthMm: OUTER_RADIUS_MM * 2, heightMm: 4.5, depthMm: OUTER_RADIUS_MM * 2 },
    attachment: { type: "finger", pointLocal: { x: 0, y: 0, z: 0 } },
    band: {
      curve: { kind: "closed", shape: "circular", radiusMm: centerlineRadiusMm },
      crossSection: { widthMm: BAND_AXIAL_HEIGHT_MM, depthMm: radialThicknessMm },
      materialId: GOLD_MATERIAL_ID,
      segments: 32,
    },
    pendant: {
      // The ring's "setting" -- see ring-strategy.ts's file docstring for why a
      // setting IS a pendant in this system's shared terms.
      widthMm: 5,
      heightMm: 4,
      depthMm: 3,
      positionOnCurve: 0,
      forwardOffsetMm: radialThicknessMm / 2 + 1.5,
      materialId: GOLD_MATERIAL_ID,
      gem: {
        shape: "faceted",
        widthMm: 3,
        heightMm: 3,
        depthMm: 2,
        materialId: DIAMOND_MATERIAL_ID,
        positionLocal: { x: 0, y: 0, z: 1.5 },
      },
    },
    repeatingElements: [
      {
        kind: "ornament",
        count: 6,
        placement: "radial",
        elementSizeMm: { widthMm: 1.5, heightMm: 1.5, depthMm: 1 },
        materialId: GOLD_MATERIAL_ID,
      },
    ],
    gems: null,
    materials: [
      { id: GOLD_MATERIAL_ID, preset: "gold" },
      { id: DIAMOND_MATERIAL_ID, preset: "diamond" },
    ],
    symmetry: { mirrored: false },
    generation: { curveSegments: 32 },
  };
}
