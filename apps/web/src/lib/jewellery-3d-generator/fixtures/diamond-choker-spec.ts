/**
 * Phase D Step 10 — the Diamond Choker as the FIRST validation of the generic
 * system, not a hardcoded generator of its own. This module only ADAPTS the
 * already-existing `docs/diamond-choker-prototype-measurements.json` (produced in
 * the previous phase, unchanged here) into the generic `Jewellery3DSpecification`
 * shape -- it contains no jewellery-specific geometry code; all actual geometry
 * comes from `strategies/necklace-strategy.ts` composing the shared primitives.
 *
 * A few numbers below are NOT in the measurements JSON (that document only measured/
 * derived overall proportions, not e.g. an individual drop's taper ratio between
 * neighbors, or exactly how many discrete drops the fringe has) -- these are flagged
 * explicitly as GEOMETRY-CONSTRUCTION CHOICES, distinct from the measurement JSON's
 * own already-labeled estimates, and are never claimed to be measured.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildJewelleryCurve } from "@/lib/jewellery-3d-generator/curves";
import { computeBandFrameAt, mirrorPositionAcrossAxis } from "@/lib/jewellery-3d-generator/primitives";
import type { Jewellery3DSpecification } from "@/lib/jewellery-3d-generator/types";

interface DiamondChokerMeasurements {
  status: string;
  jewellery_id: string;
  disclaimer: string;
  physical_width_mm: number;
  physical_height_mm: number;
  physical_depth_mm: number;
  band_thickness_mm: number;
  central_pendant_width_mm: number;
  central_pendant_height_mm: number;
  drop_length_mm: number;
  horizontal_wrap_sagitta_mm: number;
  attachment_type: string;
  attachment_point_local: { x: number; y: number; z: number };
}

/** Reads the existing, already-committed measurements document -- same technique
 * (and same "vitest always runs with apps/web as cwd" justification) as
 * `diamond-choker-prototype-measurements.test.ts`, so this adapter reads the SAME
 * file that test already validates, never a second copy of the numbers. */
function readMeasurements(): DiamondChokerMeasurements {
  const jsonPath = resolve(process.cwd(), "..", "..", "docs", "diamond-choker-prototype-measurements.json");
  return JSON.parse(readFileSync(jsonPath, "utf-8"));
}

const GOLD_MATERIAL_ID = "gold";
const DIAMOND_MATERIAL_ID = "diamond";

export function buildDiamondChokerSpecification(): Jewellery3DSpecification {
  const m = readMeasurements();
  const halfWidth = m.physical_width_mm / 2;

  // The band's own front-arc curve: center point at local origin (matches the
  // measurements JSON's own attachment_point_local), ends pulled back by the
  // measured horizontal_wrap_sagitta_mm -- see docs/diamond-choker-prototype-
  // measurements.md §2 for why a gentle sagitta was used instead of a circular arc.
  const curveSpec = {
    kind: "open" as const,
    shape: "control-points" as const,
    controlPoints: [
      { x: -halfWidth, y: 0, z: -m.horizontal_wrap_sagitta_mm },
      { x: 0, y: 0, z: 0 },
      { x: halfWidth, y: 0, z: -m.horizontal_wrap_sagitta_mm },
    ],
  };

  const bandSpec = {
    curve: curveSpec,
    crossSection: { widthMm: m.band_thickness_mm, depthMm: m.physical_depth_mm },
    materialId: GOLD_MATERIAL_ID,
  };

  // GEOMETRY-CONSTRUCTION CHOICES (not in the measurements JSON, not claimed to be
  // measured): drop count, taper ratio, and accent-gem placement below.
  const DROP_COUNT = 9;
  const DROP_TAPER_RATIO = 0.4;
  const accentGemFrame = computeBandFrameAt(buildJewelleryCurve(curveSpec), 0.4, undefined);
  const accentGemForwardOffsetMm = m.physical_depth_mm / 2;
  const accentGemPositionLeft = accentGemFrame.center.clone().addScaledVector(accentGemFrame.depthDir, accentGemForwardOffsetMm);

  return {
    id: m.jewellery_id,
    category: "necklace",
    status: "prototype_estimated",
    provenanceNote: m.disclaimer,
    dimensions: { widthMm: m.physical_width_mm, heightMm: m.physical_height_mm, depthMm: m.physical_depth_mm },
    attachment: { type: m.attachment_type, pointLocal: m.attachment_point_local },
    band: bandSpec,
    pendant: {
      widthMm: m.central_pendant_width_mm,
      heightMm: m.central_pendant_height_mm,
      depthMm: m.physical_depth_mm,
      positionOnCurve: 0.5,
      forwardOffsetMm: m.physical_depth_mm / 2,
      materialId: GOLD_MATERIAL_ID,
      gem: {
        shape: "faceted",
        widthMm: m.central_pendant_width_mm * 0.5,
        heightMm: m.central_pendant_height_mm * 0.5,
        depthMm: m.physical_depth_mm * 0.5,
        materialId: DIAMOND_MATERIAL_ID,
        positionLocal: { x: 0, y: 0, z: m.physical_depth_mm / 2 },
      },
    },
    repeatingElements: [
      {
        kind: "drop",
        count: DROP_COUNT,
        placement: "linear",
        graduated: { shortestMm: m.drop_length_mm * DROP_TAPER_RATIO, longestMm: m.drop_length_mm },
        elementSizeMm: { widthMm: m.drop_length_mm * DROP_TAPER_RATIO, heightMm: m.drop_length_mm, depthMm: m.drop_length_mm * DROP_TAPER_RATIO },
        materialId: DIAMOND_MATERIAL_ID,
      },
    ],
    gems: [
      { shape: "faceted", widthMm: 6, heightMm: 6, depthMm: 4, materialId: DIAMOND_MATERIAL_ID, positionLocal: { x: accentGemPositionLeft.x, y: accentGemPositionLeft.y, z: accentGemPositionLeft.z } },
      {
        shape: "faceted",
        widthMm: 6,
        heightMm: 6,
        depthMm: 4,
        materialId: DIAMOND_MATERIAL_ID,
        positionLocal: mirrorPositionAcrossAxis({ x: accentGemPositionLeft.x, y: accentGemPositionLeft.y, z: accentGemPositionLeft.z }, "x"),
      },
    ],
    materials: [
      { id: GOLD_MATERIAL_ID, preset: "gold" },
      { id: DIAMOND_MATERIAL_ID, preset: "diamond" },
    ],
    symmetry: { mirrored: true, axis: "x", measuredScore: 0.928 },
    generation: { curveSegments: 48 },
  };
}
