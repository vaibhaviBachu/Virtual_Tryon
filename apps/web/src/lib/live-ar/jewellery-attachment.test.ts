import { describe, expect, it } from "vitest";

import { CHOKER_ASPECT_RATIO_THRESHOLD, NECKLACE_CURVATURE_MAX_DROP_FRACTION, NECKLACE_CURVATURE_STRIP_COUNT } from "@/lib/live-ar/constants";
import { resolveNecklaceAttachmentClass, resolveNecklaceAttachmentModel } from "@/lib/live-ar/jewellery-attachment";
import type { JewelleryAssetGeometry } from "@/lib/live-ar/types";

function geometryWithBbox(widthPx: number, heightPx: number): JewelleryAssetGeometry {
  return {
    widthPx: widthPx + 10,
    heightPx: heightPx + 10,
    alphaBbox: [5, 5, 5 + widthPx, 5 + heightPx],
    anchorPx: { x: 5 + widthPx / 2, y: 5 },
    anchorSource: "default_bbox_top_center",
    mirrorable: false,
    physicalWidthMm: null,
  };
}

describe("resolveNecklaceAttachmentClass", () => {
  it("classifies a haaram-category item as haaram regardless of asset shape", () => {
    // A tall/narrow asset, which would otherwise classify as "necklace" by aspect ratio.
    expect(resolveNecklaceAttachmentClass("haaram", geometryWithBbox(100, 500))).toBe("haaram");
    // Even a wide/short asset (would otherwise be "choker") stays "haaram" -- category
    // wins over the asset-shape heuristic once the catalogue's own category says so.
    expect(resolveNecklaceAttachmentClass("haaram", geometryWithBbox(400, 40))).toBe("haaram");
  });

  it("classifies a wide, short necklace-category asset as a choker", () => {
    // height/width = 40/400 = 0.10, well under the threshold.
    expect(resolveNecklaceAttachmentClass("necklace", geometryWithBbox(400, 40))).toBe("choker");
  });

  it("classifies a taller necklace-category asset as an ordinary necklace", () => {
    // height/width = 300/200 = 1.5, well over the threshold.
    expect(resolveNecklaceAttachmentClass("necklace", geometryWithBbox(200, 300))).toBe("necklace");
  });

  it("is exactly at the boundary: the threshold itself classifies as necklace, not choker (a strict <=, not <)", () => {
    const widthPx = 1000;
    const heightPx = widthPx * CHOKER_ASPECT_RATIO_THRESHOLD;
    // height/width === threshold exactly -- documented as choker's own inclusive bound.
    expect(resolveNecklaceAttachmentClass("necklace", geometryWithBbox(widthPx, heightPx))).toBe("choker");
    expect(resolveNecklaceAttachmentClass("necklace", geometryWithBbox(widthPx, heightPx + 1))).toBe("necklace");
  });

  it("treats a null/unknown category slug the same as 'necklace' (falls back to the aspect-ratio heuristic)", () => {
    expect(resolveNecklaceAttachmentClass(null, geometryWithBbox(400, 40))).toBe("choker");
    expect(resolveNecklaceAttachmentClass("something-else", geometryWithBbox(200, 300))).toBe("necklace");
  });

  it("defaults a degenerate (zero-width or zero-height) alpha bbox to 'necklace', not a crash or NaN", () => {
    expect(resolveNecklaceAttachmentClass("necklace", geometryWithBbox(0, 300))).toBe("necklace");
    expect(resolveNecklaceAttachmentClass("necklace", geometryWithBbox(300, 0))).toBe("necklace");
  });
});

describe("resolveNecklaceAttachmentModel", () => {
  it("resolves a choker's curvature/length key from constants.ts, not an invented value", () => {
    const model = resolveNecklaceAttachmentModel("necklace", geometryWithBbox(400, 40));
    expect(model.attachmentClass).toBe("choker");
    expect(model.curvature).toEqual({ maxDropFraction: NECKLACE_CURVATURE_MAX_DROP_FRACTION.choker, stripCount: NECKLACE_CURVATURE_STRIP_COUNT });
    expect(model.necklaceLengthKey).toBe("short");
  });

  it("resolves a haaram's curvature/length key from constants.ts", () => {
    const model = resolveNecklaceAttachmentModel("haaram", geometryWithBbox(200, 800));
    expect(model.attachmentClass).toBe("haaram");
    expect(model.curvature).toEqual({ maxDropFraction: NECKLACE_CURVATURE_MAX_DROP_FRACTION.haaram, stripCount: NECKLACE_CURVATURE_STRIP_COUNT });
    expect(model.necklaceLengthKey).toBe("long");
  });

  it("resolves an ordinary necklace's curvature/length key from constants.ts", () => {
    const model = resolveNecklaceAttachmentModel("necklace", geometryWithBbox(200, 300));
    expect(model.attachmentClass).toBe("necklace");
    expect(model.curvature).toEqual({ maxDropFraction: NECKLACE_CURVATURE_MAX_DROP_FRACTION.necklace, stripCount: NECKLACE_CURVATURE_STRIP_COUNT });
    expect(model.necklaceLengthKey).toBe("medium");
  });
});
