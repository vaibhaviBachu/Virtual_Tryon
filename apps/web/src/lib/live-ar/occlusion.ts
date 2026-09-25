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
 * REGION vs. ALPHA (2026-09-24 controlled validation's central correction): everything
 * above decides occlusion against `region` -- the necklace's rectangular BOUNDING BOX
 * (`computeTransformedBoundingBox`). A real-device test found this alone is too coarse:
 * a jewellery asset's own alpha channel has large transparent areas INSIDE that
 * rectangle (the gaps of an open chain, negative space around a pendant, etc.), and
 * hair sitting in that empty space was being counted as "hair in the necklace region"
 * even though it never actually touches a visible gold pixel. `computeNecklaceOcclusionMask`
 * below still decides WHICH CATEGORIES may occlude (unchanged); the NEW
 * `applyJewelleryAlphaToOcclusionMask` (further down) then ANDs that decision against
 * the jewellery's own real, transformed alpha, so hair only actually occludes where a
 * jewellery pixel really is. `region` remains useful on its own (e.g. the original
 * bounding-box hair percentage) precisely BECAUSE it is coarser -- the two numbers
 * together (bounding-box % vs. alpha-overlap %) are what expose the gap this section
 * describes; see `computeJewelleryAlphaOcclusionReport` for both at once.
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

/** The clipped, integer pixel window every occlusion function below scans -- extracted
 * as ONE shared implementation (2026-09-24 controlled validation's own Step 3 principle
 * -- "there must be one source of truth" -- applied here too: this exact
 * floor/ceil/clamp was previously duplicated in five different functions in this file,
 * a real risk of the copies silently drifting apart). `width`/`height` are the clipped
 * window's own size in mask pixels -- exactly the dimensions any region-aligned buffer
 * (e.g. a jewellery alpha buffer) must have to line up with this window. */
export interface ClippedMaskWindow {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function clipRegionToMask(region: OcclusionRegion, maskWidthPx: number, maskHeightPx: number): ClippedMaskWindow {
  const left = Math.max(0, Math.floor(region.leftPx));
  const top = Math.max(0, Math.floor(region.topPx));
  const right = Math.min(maskWidthPx, Math.ceil(region.rightPx));
  const bottom = Math.min(maskHeightPx, Math.ceil(region.bottomPx));
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * 2026-09-24 controlled real-device validation, Step 5/6/12: the coordinate math that
 * keeps the jewellery's own alpha (rendered into a small LOCAL canvas sized to its
 * on-screen bounding box -- see useLiveArSession.ts) aligned with the CLIPPED
 * mask-space region `computeNecklaceOcclusionMask` itself scans, under any
 * combination of scale/rotation/translation the live transform produces. Pure
 * coordinate math, no Canvas access -- extracted specifically so this alignment logic
 * is directly unit-testable (Step 12's "scale/rotation/translation -> alpha remains
 * aligned" cases), not just exercised implicitly inside the render loop.
 *
 * The caller draws the jewellery's alpha into a LOCAL canvas at 1:1 CANVAS/video
 * resolution (the same resolution the real transform already operates in -- rotation
 * and scale are applied there, correctly, exactly as the real sprite is drawn). This
 * function only computes WHICH fractional sub-rectangle of that local canvas
 * corresponds to the clipped mask-space window, so a single `drawImage` downscale
 * (never a second transform) produces an alpha buffer whose pixels line up
 * index-for-index with `categoryData` at the SAME clip window. Handles the case where
 * `region` was itself clipped (e.g. the bounding box partially exceeds the mask/frame
 * edge) -- `clip` may be a strict sub-rectangle of the unclipped `region`.
 */
export interface AlphaDownscaleSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function computeAlphaDownscaleSourceRect(
  region: OcclusionRegion,
  clip: ClippedMaskWindow,
  videoWidthPx: number,
  videoHeightPx: number,
  maskWidthPx: number,
  maskHeightPx: number
): AlphaDownscaleSourceRect {
  const scaleX = maskWidthPx / videoWidthPx;
  const scaleY = maskHeightPx / videoHeightPx;
  return {
    sx: (clip.left - region.leftPx) / scaleX,
    sy: (clip.top - region.topPx) / scaleY,
    sw: clip.width / scaleX,
    sh: clip.height / scaleY,
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
  const { left, top, right, bottom } = clipRegionToMask(region, maskWidthPx, maskHeightPx);
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

// Below this alpha value (out of 255), a pixel is treated as "no real jewellery here" --
// matches the same low-bar convention `asset-cache.ts`'s own alpha bbox scan uses
// (`alpha > 0`), loosened slightly to tolerate anti-aliased edge pixels rather than
// requiring perfect opacity.
const DEFAULT_JEWELLERY_ALPHA_THRESHOLD = 10;

/**
 * 2026-09-24 controlled validation, Step 2/4: refines a category-rule occlusion mask
 * (from `computeNecklaceOcclusionMask` above) against the jewellery's OWN real,
 * transformed alpha -- "are hair pixels actually located underneath non-transparent
 * jewellery pixels," not "is there hair somewhere inside the jewellery bounding
 * rectangle." Can only ever REMOVE occlusion the category rule proposed, never add any
 * (a pixel with no jewellery there has nothing to occlude, regardless of category) --
 * this is a boolean AND, not a second, competing decision.
 *
 * `jewelleryAlphaAtRegion` must be aligned to the SAME clip window this function (and
 * `computeNecklaceOcclusionMask`) derives from `region`/`maskWidthPx`/`maskHeightPx` --
 * i.e. exactly `(right-left) * (bottom-top)` bytes, row-major, starting at
 * (region.left, region.top). See useLiveArSession.ts for how that buffer is produced
 * (rendering the jewellery sprite's own alpha through its real transform, then
 * downscaling to this exact grid) -- this function only consumes it, never renders
 * anything itself, keeping this file's existing Canvas-free convention.
 */
export function applyJewelleryAlphaToOcclusionMask(
  categoryOcclusionMask: Uint8ClampedArray,
  maskWidthPx: number,
  maskHeightPx: number,
  region: OcclusionRegion,
  jewelleryAlphaAtRegion: Uint8ClampedArray,
  alphaThresholdOutOf255: number = DEFAULT_JEWELLERY_ALPHA_THRESHOLD
): Uint8ClampedArray {
  const { left, top, right, bottom, width: regionWidth } = clipRegionToMask(region, maskWidthPx, maskHeightPx);
  if (regionWidth <= 0 || bottom <= top) return categoryOcclusionMask;

  const refined = new Uint8ClampedArray(categoryOcclusionMask);
  for (let y = top; y < bottom; y++) {
    const maskRowOffset = y * maskWidthPx;
    const alphaRowOffset = (y - top) * regionWidth;
    for (let x = left; x < right; x++) {
      const maskIdx = maskRowOffset + x;
      if (refined[maskIdx] === 0) continue; // category rule already says non-occluding
      const alpha = jewelleryAlphaAtRegion[alphaRowOffset + (x - left)] ?? 0;
      if (alpha < alphaThresholdOutOf255) refined[maskIdx] = 0; // no real jewellery pixel here
    }
  }
  return refined;
}

/**
 * Phase G (docs/true-3d-neck-attachment.md §13/14): the 3D-rendering counterpart to
 * `applyJewelleryAlphaToOcclusionMask` above. That function needs a REGION because
 * the 2D path renders the jewellery sprite into a small, bbox-cropped local canvas
 * (a real performance optimization for a Canvas-2D sprite draw). The 3D path has no
 * equivalent need: `three-live-bridge.ts`'s renderer already draws into a
 * full-video-sized canvas every frame, so its alpha channel -- downscaled directly
 * to the segmentation mask's own resolution, with NO region/crop math needed -- is
 * already aligned index-for-index with `categoryOcclusionMask`. This is the ACTUAL
 * 3D jewellery alpha (Step 14's own ask), not the jewellery's bounding box: a pixel
 * only occludes when the category rule says so AND the 3D render actually has a
 * real (non-transparent) jewellery pixel there.
 */
export function applyRenderedAlphaToOcclusionMask(
  categoryOcclusionMask: Uint8ClampedArray,
  renderedAlphaMask: Uint8ClampedArray,
  alphaThresholdOutOf255: number = DEFAULT_JEWELLERY_ALPHA_THRESHOLD
): Uint8ClampedArray {
  const length = Math.min(categoryOcclusionMask.length, renderedAlphaMask.length);
  const refined = new Uint8ClampedArray(categoryOcclusionMask);
  for (let i = 0; i < length; i++) {
    if (refined[i] === 0) continue; // category rule already says non-occluding
    if (renderedAlphaMask[i] < alphaThresholdOutOf255) refined[i] = 0; // no real 3D jewellery pixel here
  }
  return refined;
}

/** 2026-09-24 controlled validation, Step 8: the two clearly-separated metrics the
 * bounding-box-only percentage conflated -- "Actual jewellery pixels" as the
 * denominator, never the bounding box, per that step's explicit instruction. Computed
 * in one pass since `refinedOcclusionMask` (from `applyJewelleryAlphaToOcclusionMask`)
 * and `jewelleryAlphaAtRegion` are already both available by the time this runs. */
export interface JewelleryAlphaOcclusionReport {
  jewelleryPixelCount: number;
  hairOverJewelleryPixelCount: number;
  hairOverJewelleryPct: number;
  /** 2026-09-24, round 2: raw clothes-over-jewellery overlap -- ALL clothing pixels
   * over real jewellery alpha, regardless of the attachment-line rule (that rule still
   * governs what actually occludes, in `applyJewelleryAlphaToOcclusionMask`; this is a
   * diagnostic, so it deliberately does NOT apply that restriction, precisely so a
   * real device can distinguish "no clothing detected there at all" from "clothing IS
   * there, but correctly not occluding below the attachment line"). */
  clothesOverJewelleryPixelCount: number;
  clothesOverJewelleryPct: number;
  finalVisiblePixelCount: number;
  finalVisibilityPct: number;
}

const EMPTY_ALPHA_OCCLUSION_REPORT: JewelleryAlphaOcclusionReport = {
  jewelleryPixelCount: 0,
  hairOverJewelleryPixelCount: 0,
  hairOverJewelleryPct: 0,
  clothesOverJewelleryPixelCount: 0,
  clothesOverJewelleryPct: 0,
  finalVisiblePixelCount: 0,
  finalVisibilityPct: 100,
};

export function computeJewelleryAlphaOcclusionReport(
  categoryData: Uint8Array,
  refinedOcclusionMask: Uint8ClampedArray,
  maskWidthPx: number,
  maskHeightPx: number,
  region: OcclusionRegion,
  jewelleryAlphaAtRegion: Uint8ClampedArray,
  alphaThresholdOutOf255: number = DEFAULT_JEWELLERY_ALPHA_THRESHOLD
): JewelleryAlphaOcclusionReport {
  const { left, top, right, bottom, width: regionWidth } = clipRegionToMask(region, maskWidthPx, maskHeightPx);
  if (regionWidth <= 0 || bottom <= top) return EMPTY_ALPHA_OCCLUSION_REPORT;

  let jewelleryPixelCount = 0;
  let hairOverJewelleryPixelCount = 0;
  let clothesOverJewelleryPixelCount = 0;
  let finalVisiblePixelCount = 0;
  for (let y = top; y < bottom; y++) {
    const maskRowOffset = y * maskWidthPx;
    const alphaRowOffset = (y - top) * regionWidth;
    for (let x = left; x < right; x++) {
      const alpha = jewelleryAlphaAtRegion[alphaRowOffset + (x - left)] ?? 0;
      if (alpha < alphaThresholdOutOf255) continue; // no real jewellery pixel here
      jewelleryPixelCount++;
      const maskIdx = maskRowOffset + x;
      const category = categoryData[maskIdx];
      if (category === HAIR_CATEGORY) hairOverJewelleryPixelCount++;
      if (category === CLOTHES_CATEGORY) clothesOverJewelleryPixelCount++;
      if (refinedOcclusionMask[maskIdx] === 0) finalVisiblePixelCount++;
    }
  }
  if (jewelleryPixelCount === 0) return EMPTY_ALPHA_OCCLUSION_REPORT;
  return {
    jewelleryPixelCount,
    hairOverJewelleryPixelCount,
    hairOverJewelleryPct: (hairOverJewelleryPixelCount / jewelleryPixelCount) * 100,
    clothesOverJewelleryPixelCount,
    clothesOverJewelleryPct: (clothesOverJewelleryPixelCount / jewelleryPixelCount) * 100,
    finalVisiblePixelCount,
    finalVisibilityPct: (finalVisiblePixelCount / jewelleryPixelCount) * 100,
  };
}

/** Plain-text rendering matching Step 8's exact requested format, distinguishing the
 * OLD bounding-box metric from the NEW alpha-scoped ones side by side, specifically so
 * the gap between them (the whole point of this correction) stays visible rather than
 * silently replaced. */
export function formatJewelleryAlphaOcclusionReport(
  boundingBoxHairPct: number,
  r: JewelleryAlphaOcclusionReport
): string {
  if (r.jewelleryPixelCount === 0) {
    return `Necklace bounding box: hair=${boundingBoxHairPct.toFixed(1)}% / Actual jewellery footprint: 0 pixels (region empty/off-mask)`;
  }
  return (
    `Necklace bounding box: hair=${boundingBoxHairPct.toFixed(1)}% / ` +
    `Actual jewellery footprint (${r.jewelleryPixelCount}px): ` +
    `hair-over-jewellery=${r.hairOverJewelleryPct.toFixed(1)}% (${r.hairOverJewelleryPixelCount}px), ` +
    `clothes-over-jewellery=${r.clothesOverJewelleryPct.toFixed(1)}% (${r.clothesOverJewelleryPixelCount}px) / ` +
    `Final jewellery visible px=${r.finalVisiblePixelCount} (${r.finalVisibilityPct.toFixed(1)}%)`
  );
}

/** 2026-09-24 controlled validation, Step 9/10: "GREEN = visible jewellery pixels, RED
 * = hair occlusion, BLUE = clothing occlusion, BLACK = transparent/non-jewellery."
 *
 * Takes `refinedOcclusionMask` -- the SAME final decision
 * `applyJewelleryAlphaToOcclusionMask` produced and the real compositor actually
 * applied -- as a DIRECT input, rather than re-deriving the attachment-line rule
 * independently from `region`/`categoryData` a second time. An earlier version of this
 * function did re-derive that rule inline; while numerically equivalent (both read the
 * exact same documented rule), that duplication was a real, if latent, risk that this
 * visualization could silently drift from the actual compositor decision if the rule
 * ever changed in one place and not the other. Taking the real mask directly removes
 * that risk by construction, not by the two copies happening to agree today -- the
 * 2026-09-24 real-device verification request's own "verify... do not create a
 * separate approximate debug algorithm" instruction, applied literally rather than
 * just satisfied by coincidence. `categoryData` is still used, but only to LABEL which
 * category caused an already-decided occlusion (RED vs. BLUE), never to decide
 * whether occlusion happened. Always fully opaque (a standalone diagnostic panel,
 * matching `buildFinalVisibilityMaskRgba`'s convention), full mask size so it can reuse
 * the same scaled-blit draw every other debug overlay in this codebase already uses. */
export function buildJewelleryAlphaDebugRgba(
  categoryData: Uint8Array,
  refinedOcclusionMask: Uint8ClampedArray,
  maskWidthPx: number,
  maskHeightPx: number,
  region: OcclusionRegion,
  jewelleryAlphaAtRegion: Uint8ClampedArray,
  alphaThresholdOutOf255: number = DEFAULT_JEWELLERY_ALPHA_THRESHOLD
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(maskWidthPx * maskHeightPx * 4);
  // Every pixel starts BLACK, fully opaque (rgba initializes to 0 -- alpha needs setting).
  for (let i = 0; i < maskWidthPx * maskHeightPx; i++) rgba[i * 4 + 3] = 255;

  const { left, top, right, bottom, width: regionWidth } = clipRegionToMask(region, maskWidthPx, maskHeightPx);
  if (regionWidth <= 0 || bottom <= top) return rgba;

  for (let y = top; y < bottom; y++) {
    const maskRowOffset = y * maskWidthPx;
    const alphaRowOffset = (y - top) * regionWidth;
    for (let x = left; x < right; x++) {
      const alpha = jewelleryAlphaAtRegion[alphaRowOffset + (x - left)] ?? 0;
      if (alpha < alphaThresholdOutOf255) continue; // stays black -- no jewellery here
      const maskIdx = maskRowOffset + x;
      const offset = maskIdx * 4;
      if (refinedOcclusionMask[maskIdx] === 0) {
        rgba[offset + 1] = 255; // GREEN -- real jewellery pixel, not occluded -> visible
        continue;
      }
      // Occluded (per the REAL mask, not re-derived) -- categoryData only labels WHICH
      // category caused it, never re-decides whether it did.
      if (categoryData[maskIdx] === HAIR_CATEGORY) {
        rgba[offset] = 255; // RED -- hair occlusion
      } else {
        rgba[offset + 2] = 255; // BLUE -- clothing occlusion (the only other category that can occlude)
      }
    }
  }
  return rgba;
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
  const { left, top, right, bottom } = clipRegionToMask(region, maskWidthPx, maskHeightPx);
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
  const { left, top, right, bottom } = clipRegionToMask(region, maskWidthPx, maskHeightPx);
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
