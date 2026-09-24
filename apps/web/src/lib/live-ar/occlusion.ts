/**
 * Segmentation-aware 2D necklace occlusion -- M6.4
 * (docs/live-ar-realism-architecture.md §6/§7/§17). This is explicitly NOT 3D
 * depth-aware occlusion: it decides, per pixel of the segmentation mask, whether that
 * pixel's category should be drawn IN FRONT OF the necklace, using one documented rule
 * -- nothing here reasons about real depth/distance.
 *
 * DOCUMENTED OCCLUSION RULE (necklace only -- this milestone does not touch earrings):
 * - HAIR occludes the necklace ANYWHERE within the necklace's own rendered region. This
 *   is the headline physical case (Step 21 of the request that produced this
 *   milestone): hair commonly falls in front of a worn necklace, and this must be
 *   visibly true or the milestone has not worked, regardless of what automated tests
 *   say.
 * - CLOTHES occludes the necklace ONLY at or above the necklace's own neck-attachment
 *   point (the same `transform.anchorPx.y` computed by geometry.ts's
 *   `computeNecklaceAnchor` -- no new geometry, reusing the existing anchor). Physical
 *   reasoning: a collar can ride up and cover the very top of a necklace near the neck,
 *   but a necklace normally rests ON TOP of clothing everywhere below that -- occluding
 *   the necklace's whole lower/chest portion just because a pixel there is classified
 *   "clothes" would make the necklace vanish incorrectly, which the request producing
 *   this milestone explicitly warned against ("do NOT simply hide the entire necklace
 *   wherever class = clothes").
 * - BACKGROUND, BODY-SKIN, FACE-SKIN, and OTHERS never occlude. A worn necklace sits in
 *   front of skin and background by definition; letting those categories hide it would
 *   be treating a segmentation misclassification as ground truth, not modeling a real
 *   occlusion case.
 *
 * This module is deliberately Canvas/DOM-free -- every function here operates on plain
 * typed arrays and numbers, so it is fully unit-testable without the real
 * `getContext("2d")`/`ImageData` this project's jsdom test environment does not
 * implement (verified directly in M6.3, not assumed). The actual on-screen compositing
 * (turning this module's output into pixels) lives in renderer.ts, mirroring the
 * existing project convention of keeping pure decision logic separate from Canvas calls.
 */

const HAIR_CATEGORY = 1;
const CLOTHES_CATEGORY = 4;

/** A jewellery item's rendered region and its neck-attachment Y, all expressed in the
 * SAME pixel space as the segmentation mask itself (maskWidthPx x maskHeightPx) -- see
 * `toMaskSpaceRegion` below for converting from canvas/video pixel space, which is the
 * space every other Live AR module (geometry.ts, renderer.ts) actually works in. */
export interface OcclusionRegion {
  leftPx: number;
  topPx: number;
  rightPx: number;
  bottomPx: number;
  /** Clothing only occludes at/above this Y (smaller y = higher, per this project's
   * top-left-origin convention -- see types.ts) -- see the file docstring's clothing
   * rule for the physical reasoning. */
  attachmentYPx: number;
}

/** Converts a jewellery region already expressed in CANVAS/video pixel space (e.g.
 * geometry.ts's `computeTransformedBoundingBox` output, and a transform's own
 * `anchorPx.y`) into the segmentation mask's own native pixel space. The mask is
 * produced at its OWN resolution (e.g. 256x256), not the video's (see segmentation.ts's
 * file docstring) -- this is a plain per-axis scale, matching the same stretch mapping
 * `drawSegmentationDebugOverlay` already uses and that M6.3's real-device check found
 * "no obvious global coordinate/mirroring displacement" for. If the mask's aspect ratio
 * genuinely differs from the video's, this per-axis (not uniform) scale still maps
 * bounds correctly -- it never assumes a single shared scale factor for both axes. */
export function toMaskSpaceRegion(
  canvasBboxLTRB: readonly [number, number, number, number],
  attachmentYCanvasPx: number,
  videoWidthPx: number,
  videoHeightPx: number,
  maskWidthPx: number,
  maskHeightPx: number
): OcclusionRegion {
  const scaleX = maskWidthPx / videoWidthPx;
  const scaleY = maskHeightPx / videoHeightPx;
  const [left, top, right, bottom] = canvasBboxLTRB;
  return {
    leftPx: left * scaleX,
    topPx: top * scaleY,
    rightPx: right * scaleX,
    bottomPx: bottom * scaleY,
    attachmentYPx: attachmentYCanvasPx * scaleY,
  };
}

/**
 * Pure decision function: given a segmentation category mask and one necklace's
 * rendered region (already in the mask's own coordinate space -- see
 * `toMaskSpaceRegion`), returns a same-size Uint8ClampedArray, one byte per mask pixel:
 * 255 where that pixel should occlude the necklace (drawn in front of it), 0 everywhere
 * else -- including every pixel outside `region` (nothing outside the necklace's own
 * footprint can occlude it, there being nothing there to occlude). See the file
 * docstring for the exact, documented rule this implements.
 */
export function computeNecklaceOcclusionMask(
  categoryData: Uint8Array,
  maskWidthPx: number,
  maskHeightPx: number,
  region: OcclusionRegion
): Uint8ClampedArray {
  const occlusion = new Uint8ClampedArray(maskWidthPx * maskHeightPx);
  const left = Math.max(0, Math.floor(region.leftPx));
  const top = Math.max(0, Math.floor(region.topPx));
  const right = Math.min(maskWidthPx, Math.ceil(region.rightPx));
  const bottom = Math.min(maskHeightPx, Math.ceil(region.bottomPx));
  for (let y = top; y < bottom; y++) {
    const rowOffset = y * maskWidthPx;
    for (let x = left; x < right; x++) {
      const category = categoryData[rowOffset + x];
      const occludes = category === HAIR_CATEGORY || (category === CLOTHES_CATEGORY && y <= region.attachmentYPx);
      occlusion[rowOffset + x] = occludes ? 255 : 0;
    }
  }
  return occlusion;
}

/** Whether a mask of the given age should still be trusted for occlusion (Step 13).
 * A trivial comparison, but named/exported so the threshold and the decision it drives
 * are never re-derived ad hoc at a call site. */
export function isMaskStale(ageMs: number | null, thresholdMs: number): boolean {
  return ageMs === null || ageMs > thresholdMs;
}

/** Converts the pure occlusion decision into an RGBA erase-pattern buffer for the REAL
 * (non-debug) compositing step: alpha = 255 wherever occluding (erase the jewellery
 * there), 0 elsewhere. RGB is irrelevant for a `destination-out` erase (only the source
 * alpha channel matters) and is left at 0. Kept separate from
 * `buildOcclusionDebugRgba` below -- one produces the actual erase mask renderer.ts
 * applies to the jewellery layer, the other is a human-readable diagnostic visual;
 * conflating them risked the debug view silently becoming load-bearing. */
export function buildOcclusionEraseRgba(occlusionMask: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(occlusionMask.length * 4);
  for (let i = 0; i < occlusionMask.length; i++) {
    rgba[i * 4 + 3] = occlusionMask[i];
  }
  return rgba;
}

/** M6.4 real-device review (2026-09-24), Step 2: "Render the exact alpha mask that is
 * actually being applied to the jewellery... WHITE = jewellery visible, BLACK =
 * jewellery hidden, GRAY = partial alpha." This is literally the complement of
 * `buildOcclusionEraseRgba` above (that one drives the erase; this one is FOR HUMAN
 * EYES, always fully opaque itself so it reads clearly as its own picture-in-picture
 * panel rather than a semi-transparent overlay on the camera). Kept as a separate
 * function from `buildOcclusionDebugRgba` below (which colors WHICH CATEGORY is
 * occluding, in-place on the camera feed) -- this answers a different question ("what
 * is the final per-pixel visibility") from a different, better-suited view (a
 * standalone thumbnail, not an overlay). */
export function buildFinalVisibilityMaskRgba(occlusionMask: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(occlusionMask.length * 4);
  for (let i = 0; i < occlusionMask.length; i++) {
    const visible = 255 - occlusionMask[i]; // 255 = fully visible (white), 0 = fully occluded (black)
    const offset = i * 4;
    rgba[offset] = visible;
    rgba[offset + 1] = visible;
    rgba[offset + 2] = visible;
    rgba[offset + 3] = 255; // always fully opaque -- this is its own standalone panel, never composited
  }
  return rgba;
}

/** M6.4 real-device review, Step 7/8: "print percentage of necklace-region pixels
 * classified as [each category]... this tells us whether the necklace is actually
 * intersecting a segmented hair region." Answers exactly that, without guessing from a
 * screenshot -- if `hairPct` is 0 on a real device even while hair visibly crosses the
 * necklace on camera, the bug is upstream (segmentation/region mapping); if `hairPct`
 * is meaningfully positive but the necklace still isn't visibly occluded, the bug is
 * downstream (compositing/display). */
export interface CategoryDistribution {
  totalPixels: number;
  // Raw counts -- 2026-09-24 controlled validation Step 2 ("Do not estimate these
  // numbers"): these are the real per-category pixel counts this function already
  // tallies internally, exposed directly rather than back-derived (rounded) from the
  // percentages below.
  backgroundCount: number;
  hairCount: number;
  bodySkinCount: number;
  faceSkinCount: number;
  clothesCount: number;
  othersCount: number;
  backgroundPct: number;
  hairPct: number;
  bodySkinPct: number;
  faceSkinPct: number;
  clothesPct: number;
  othersPct: number;
}

const EMPTY_DISTRIBUTION: CategoryDistribution = {
  totalPixels: 0,
  backgroundCount: 0,
  hairCount: 0,
  bodySkinCount: 0,
  faceSkinCount: 0,
  clothesCount: 0,
  othersCount: 0,
  backgroundPct: 0,
  hairPct: 0,
  bodySkinPct: 0,
  faceSkinPct: 0,
  clothesPct: 0,
  othersPct: 0,
};

export function computeCategoryDistribution(
  categoryData: Uint8Array,
  maskWidthPx: number,
  maskHeightPx: number,
  region: OcclusionRegion
): CategoryDistribution {
  const left = Math.max(0, Math.floor(region.leftPx));
  const top = Math.max(0, Math.floor(region.topPx));
  const right = Math.min(maskWidthPx, Math.ceil(region.rightPx));
  const bottom = Math.min(maskHeightPx, Math.ceil(region.bottomPx));
  if (right <= left || bottom <= top) return EMPTY_DISTRIBUTION;

  const counts = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let y = top; y < bottom; y++) {
    const rowOffset = y * maskWidthPx;
    for (let x = left; x < right; x++) {
      const category = categoryData[rowOffset + x];
      if (category >= 0 && category <= 5) counts[category]++;
      total++;
    }
  }
  if (total === 0) return EMPTY_DISTRIBUTION;
  const pct = (n: number) => (n / total) * 100;
  return {
    totalPixels: total,
    backgroundCount: counts[0],
    hairCount: counts[1],
    bodySkinCount: counts[2],
    faceSkinCount: counts[3],
    clothesCount: counts[4],
    othersCount: counts[5],
    backgroundPct: pct(counts[0]),
    hairPct: pct(counts[1]),
    bodySkinPct: pct(counts[2]),
    faceSkinPct: pct(counts[3]),
    clothesPct: pct(counts[4]),
    othersPct: pct(counts[5]),
  };
}

/** Plain-text rendering of a CategoryDistribution for the debug panel. */
export function formatCategoryDistribution(d: CategoryDistribution): string {
  if (d.totalPixels === 0) return "Necklace region: 0 mask pixels (region empty/off-mask)";
  return (
    `Necklace region (${d.totalPixels}px): hair=${d.hairPct.toFixed(1)}% ` +
    `skin=${(d.bodySkinPct + d.faceSkinPct).toFixed(1)}% clothes=${d.clothesPct.toFixed(1)}% ` +
    `background=${d.backgroundPct.toFixed(1)}% others=${d.othersPct.toFixed(1)}%`
  );
}

/** 2026-09-24 controlled real-device validation, Step 4: "Add a clear debug indicator:
 * HAIR/NECKLACE OVERLAP: YES / NO... Determine this from actual pixels." True whenever
 * at least one real mask pixel within the necklace's own region was classified as
 * hair -- a plain, honest threshold (>0), not a fabricated confidence score. */
export function hasHairOverlap(distribution: CategoryDistribution): boolean {
  return distribution.hairCount > 0;
}

/** Step 2's "Final jewellery visible percentage" and Step 4's "HAIR/NECKLACE OVERLAP"
 * line, computed from the ACTUAL occlusion mask the compositor used -- not estimated.
 * `occlusionMask` is the FULL mask-sized array `computeNecklaceOcclusionMask` returns
 * (0 outside the necklace's own region by construction), so this scopes its own count
 * to `region` exactly the same way `computeCategoryDistribution` does -- averaging over
 * the WHOLE mask would silently understate occlusion, since the necklace's region is
 * typically a small fraction of the full mask. `occlusionMask` and `distribution` MUST
 * come from the same region/frame -- callers (useLiveArSession.ts) always compute both
 * from the same `region`. */
export interface HairOverlapReport {
  hairNecklaceOverlap: boolean;
  hairPct: number;
  finalVisiblePct: number;
}

export function computeHairOverlapReport(
  occlusionMask: Uint8ClampedArray,
  maskWidthPx: number,
  maskHeightPx: number,
  region: OcclusionRegion,
  distribution: CategoryDistribution
): HairOverlapReport {
  const left = Math.max(0, Math.floor(region.leftPx));
  const top = Math.max(0, Math.floor(region.topPx));
  const right = Math.min(maskWidthPx, Math.ceil(region.rightPx));
  const bottom = Math.min(maskHeightPx, Math.ceil(region.bottomPx));
  if (right <= left || bottom <= top) return { hairNecklaceOverlap: false, hairPct: 0, finalVisiblePct: 100 };

  let occludedCount = 0;
  let total = 0;
  for (let y = top; y < bottom; y++) {
    const rowOffset = y * maskWidthPx;
    for (let x = left; x < right; x++) {
      if (occlusionMask[rowOffset + x] !== 0) occludedCount++;
      total++;
    }
  }
  const finalVisiblePct = total > 0 ? 100 - (occludedCount / total) * 100 : 100;
  return {
    hairNecklaceOverlap: hasHairOverlap(distribution),
    hairPct: distribution.hairPct,
    finalVisiblePct,
  };
}

/** Plain-text rendering matching the exact requested format:
 * "HAIR/NECKLACE OVERLAP: YES\nHair in necklace region: 23.7%\nFinal jewellery visibility: 82.6%" */
export function formatHairOverlapReport(r: HairOverlapReport): string {
  return (
    `HAIR/NECKLACE OVERLAP: ${r.hairNecklaceOverlap ? "YES" : "NO"} / ` +
    `Hair in necklace region: ${r.hairPct.toFixed(1)}% / ` +
    `Final jewellery visibility: ${r.finalVisiblePct.toFixed(1)}%`
  );
}

/** Debug-only visualization (Step 15/16): colors the FINAL occlusion decision itself
 * (not the raw segmentation categories -- segmentation.ts's `buildSegmentationDebugRgba`
 * already covers that) so a real device tester can see exactly which pixels of a given
 * necklace's own region are being treated as "in front of the jewellery" versus "the
 * jewellery shows through," as opposed to inferring it indirectly from the raw category
 * colors. Bright, single, deliberately different color from every category color
 * segmentation.ts uses, precisely so the two debug layers are never confused with each
 * other when both are visible at once. */
const OCCLUDING_DEBUG_COLOR: readonly [number, number, number] = [255, 0, 60];
const OCCLUDING_DEBUG_ALPHA = 180;

export function buildOcclusionDebugRgba(occlusionMask: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(occlusionMask.length * 4);
  for (let i = 0; i < occlusionMask.length; i++) {
    const offset = i * 4;
    if (occlusionMask[i] === 0) continue; // stays fully transparent (already zero-initialized)
    rgba[offset] = OCCLUDING_DEBUG_COLOR[0];
    rgba[offset + 1] = OCCLUDING_DEBUG_COLOR[1];
    rgba[offset + 2] = OCCLUDING_DEBUG_COLOR[2];
    rgba[offset + 3] = OCCLUDING_DEBUG_ALPHA;
  }
  return rgba;
}
