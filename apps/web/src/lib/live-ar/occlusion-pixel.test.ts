import { createCanvas, ImageData as NodeImageData } from "canvas";
import { beforeAll, describe, expect, it } from "vitest";

// The native `canvas` module's one-time native-binary initialization cost can be slow
// under heavy parallel load (observed directly: instant in isolation, 30+ seconds when
// 18 test files' worker threads contend for the CPU at once) -- absorbed here, in a
// beforeAll with its own generous timeout, so that cost lands in test SETUP rather than
// inside the first `it(...)`'s own timing budget. Every test body below then runs in
// milliseconds regardless of how contended the machine was during this one-time load.
beforeAll(() => {
  createCanvas(1, 1).getContext("2d");
}, 90000);

import { computeTransformedBoundingBox } from "@/lib/live-ar/geometry";
import { buildOcclusionEraseRgba, computeNecklaceOcclusionMask, toMaskSpaceRegion } from "@/lib/live-ar/occlusion";
import { drawOccludedJewelleryOverlay } from "@/lib/live-ar/renderer";
import type { JewelleryAssetGeometry, LiveTransform } from "@/lib/live-ar/types";

/**
 * M6.4 real-device review, Step 6: "create a deterministic test image... apply the
 * exact occlusion compositor... This test must operate on actual pixel buffers/
 * canvases, not just mathematical booleans. If this synthetic test fails: THE
 * COMPOSITOR IS WRONG."
 *
 * Every other occlusion/renderer test in this codebase (occlusion.test.ts,
 * renderer.test.ts) either tests pure arrays with no Canvas at all, or uses a FAKE ctx
 * object that only records which methods were called with which arguments -- neither
 * verifies real pixels, because this project's jsdom test environment has no working
 * `getContext("2d")`/`ImageData` (verified directly in M6.3 -- "Not implemented:
 * HTMLCanvasElement's getContext() method: without installing the canvas npm
 * package"). This file closes exactly that gap: it uses the real `canvas` npm package
 * (a real, C-backed Canvas 2D implementation -- confirmed directly, before writing
 * this file, that its `destination-out` semantics match the browser spec: erasing
 * `rgba(0,0,255,255)` with a `rgba(0,0,0,255)` destination-out fill produces
 * `[0,0,0,0]` under the erased area and leaves `[0,0,255,255]` untouched elsewhere)
 * to run the REAL `drawOccludedJewelleryOverlay` (renderer.ts) against a REAL offscreen
 * canvas, then reads back REAL output pixels with `getImageData`.
 *
 * This is the SAME code renderer.ts ships in production, not a reimplementation -- if
 * this test passes, the compositor itself (occlusion.ts's decision -> the erase RGBA ->
 * destination-out) is proven correct at the pixel level, and a real-camera failure to
 * show hair-over-necklace must come from somewhere this test does not cover (most
 * likely: segmentation not actually classifying hair over the necklace's real screen
 * position in that specific shot -- a coverage/resolution question, not a compositor
 * bug -- or a wiring issue in useLiveArSession.ts's React-hook glue, which this file,
 * by design, does not exercise; see this project's own established convention of
 * testing hook-owned Canvas glue only by code review + call-sequence tests, never by
 * literally running the hook).
 */

function solidOpaqueSprite(widthPx: number, heightPx: number, rgb: [number, number, number]) {
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.fillRect(0, 0, widthPx, heightPx);
  return canvas;
}

describe("real pixel-level occlusion compositor (Step 6 synthetic test)", () => {
  // Scene: a 100x100 output canvas. A 40x20px solid "necklace" sprite is drawn
  // centered at (50, 60) with its own top-center anchor at (0, 0) in sprite space --
  // so its rendered footprint on the output canvas is exactly x:[30,70], y:[60,80].
  const OUTPUT_W = 100;
  const OUTPUT_H = 100;
  const SPRITE_W = 40;
  const SPRITE_H = 20;
  const NECKLACE_GOLD: [number, number, number] = [212, 175, 55];

  const transform: LiveTransform = {
    anchorPx: { x: 50, y: 60 },
    scaleFactor: 1,
    rotationDegrees: 0,
    sourceAnchorPx: { x: SPRITE_W / 2, y: 0 }, // top-center of the sprite
    mirrored: false,
  };
  // Matches computeTransformedBoundingBox's own math for this simple no-rotation case:
  // footprint is x:[30,70], y:[60,80] on the 100x100 output canvas.
  const necklaceFootprintCanvasPx: [number, number, number, number] = [30, 60, 70, 80];

  // Mask resolution deliberately different from the output (like the real
  // 256x256-vs-video mismatch) -- 20x20, so 1 mask px = 5 output px on each axis.
  const MASK_W = 20;
  const MASK_H = 20;

  function runCompositor(categoryData: Uint8Array) {
    const region = toMaskSpaceRegion(necklaceFootprintCanvasPx, 60 /* attachmentY */, OUTPUT_W, OUTPUT_H, MASK_W, MASK_H);
    const occlusionMask = computeNecklaceOcclusionMask(categoryData, MASK_W, MASK_H, region);
    const eraseRgba = buildOcclusionEraseRgba(occlusionMask);

    const eraseCanvas = createCanvas(MASK_W, MASK_H);
    const eraseCtx = eraseCanvas.getContext("2d");
    eraseCtx.putImageData(new NodeImageData(eraseRgba, MASK_W, MASK_H) as unknown as ImageData, 0, 0);

    const sprite = solidOpaqueSprite(SPRITE_W, SPRITE_H, NECKLACE_GOLD);
    const scratchCanvas = createCanvas(OUTPUT_W, OUTPUT_H);
    const scratchCtx = scratchCanvas.getContext("2d");

    drawOccludedJewelleryOverlay(
      scratchCtx as unknown as CanvasRenderingContext2D,
      sprite as unknown as CanvasImageSource,
      transform,
      1,
      eraseCanvas as unknown as CanvasImageSource,
      MASK_W,
      MASK_H,
      OUTPUT_W,
      OUTPUT_H
    );

    return scratchCtx;
  }

  it("BASELINE: with no occluder anywhere, the entire necklace footprint renders opaque gold", () => {
    const allBackground = new Uint8Array(MASK_W * MASK_H).fill(0);
    const ctx = runCompositor(allBackground);
    const [r, g, b, a] = ctx.getImageData(50, 70, 1, 1).data; // center of the footprint
    expect([r, g, b, a]).toEqual([...NECKLACE_GOLD, 255]);
  });

  it("THE STEP 6 TEST: a hair band crossing the necklace erases exactly that part of it, real pixels, real destination-out", () => {
    // Hair covers mask rows 0-7 (canvas y 0-40, i.e. above/at the top portion of the
    // necklace footprint y:[60,80] -- rows corresponding to canvas y 60-70), clothes
    // fills the rest. In mask space: row 12-13 covers canvas y 60-70 (since 1 mask
    // row = 5 canvas px: row 12 -> y=60, row 13 -> y=65).
    const mask = new Uint8Array(MASK_W * MASK_H).fill(4); // 4 = clothes everywhere first
    for (let y = 12; y <= 13; y++) {
      for (let x = 0; x < MASK_W; x++) mask[y * MASK_W + x] = 1; // 1 = hair, rows -> canvas y 60-70
    }
    const ctx = runCompositor(mask);

    // Top half of the necklace (canvas y ~65, under the hair band) must be ERASED --
    // this is the exact visual effect Step 6/21 require: hair in front of the necklace.
    const underHair = ctx.getImageData(50, 65, 1, 1).data;
    expect(Array.from(underHair)).toEqual([0, 0, 0, 0]);

    // Bottom half of the necklace (canvas y ~78, clothes below the attachment point --
    // attachmentY=60, so this clothes pixel is BELOW it and must NOT occlude, per the
    // documented rule) must remain the necklace's own opaque gold color.
    const belowHair = ctx.getImageData(50, 78, 1, 1).data;
    expect(Array.from(belowHair)).toEqual([...NECKLACE_GOLD, 255]);
  });

  it("a hair band that does NOT overlap the necklace's footprint leaves the necklace fully opaque (correctly not occluding)", () => {
    const mask = new Uint8Array(MASK_W * MASK_H).fill(0);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < MASK_W; x++) mask[y * MASK_W + x] = 1; // hair only near canvas y 0-10, well above the necklace
    }
    const ctx = runCompositor(mask);
    const center = ctx.getImageData(50, 70, 1, 1).data;
    expect(Array.from(center)).toEqual([...NECKLACE_GOLD, 255]);
  });

  it("outside the necklace's own footprint stays transparent regardless of occlusion (nothing was ever drawn there)", () => {
    const allHair = new Uint8Array(MASK_W * MASK_H).fill(1);
    const ctx = runCompositor(allHair);
    const outside = ctx.getImageData(5, 5, 1, 1).data; // far outside footprint x:[30,70] y:[60,80]
    expect(Array.from(outside)).toEqual([0, 0, 0, 0]);
  });

  it("a fully hair-covered necklace region is entirely erased in its interior (fully opaque occluder -> fully hidden jewellery)", () => {
    // Sample points comfortably INSIDE the region, not on its literal boundary --
    // see the next test for why the boundary itself is a separate, expected case.
    const allHair = new Uint8Array(MASK_W * MASK_H).fill(1);
    const ctx = runCompositor(allHair);
    for (const [x, y] of [
      [40, 65],
      [50, 70],
      [60, 75],
    ]) {
      expect(Array.from(ctx.getImageData(x, y, 1, 1).data)).toEqual([0, 0, 0, 0]);
    }
  });

  it("DOCUMENTED, EXPECTED BEHAVIOR: the occlusion region's own clip boundary anti-aliases when the low-resolution mask is scaled up, softening (not necessarily fully erasing) pixels exactly at that edge -- this is standard Canvas 2D image-scaling behavior, not a compositor bug. Real hair crossing the MIDDLE of the necklace (the actual visual test that matters) is unaffected -- see the 'THE STEP 6 TEST' case above, which erases fully at its sample point.", () => {
    const allHair = new Uint8Array(MASK_W * MASK_H).fill(1);
    const ctx = runCompositor(allHair);
    // (69, 79) is 1px inside the true corner (70, 80) of the necklace's OWN footprint,
    // which is also right at the mapped occlusion region's own boundary in mask space
    // -- close enough to the clip edge that upscaling smooths it. It must not remain
    // fully visible (some erasure did happen) but is not required to be a full [0,0,0,0]
    // the way a comfortably-interior pixel is.
    const nearCorner = ctx.getImageData(69, 79, 1, 1).data;
    expect(nearCorner[3]).toBeLessThan(255); // NOT left fully visible
  });
});

describe("real pixel-level compositor under a REALISTIC scaled + rotated transform", () => {
  // Every test above used scale=1, rotation=0 -- the simplest possible case. Real
  // catalogue necklace assets are heavily downscaled (constants.ts's MIN_SCALE_FACTOR
  // is as low as 0.03) and can carry non-zero rotation from shoulder tilt. This test
  // uses computeTransformedBoundingBox -- the SAME real function geometry.ts/
  // useLiveArSession.ts actually call -- to derive the footprint, rather than hand-
  // computing it, so a real bug in that function's math would show up here too.
  const OUTPUT_W = 200;
  const OUTPUT_H = 200;
  const NECKLACE_GOLD: [number, number, number] = [212, 175, 55];
  // A larger native sprite (closer to a real catalogue asset's own pixel size),
  // downscaled substantially, with a real rotation.
  const SPRITE_W = 300;
  const SPRITE_H = 150;

  const transform: LiveTransform = {
    anchorPx: { x: 100, y: 110 },
    scaleFactor: 0.3,
    rotationDegrees: 12,
    sourceAnchorPx: { x: SPRITE_W / 2, y: 0 },
    mirrored: false,
  };
  const assetGeometry: JewelleryAssetGeometry = {
    widthPx: SPRITE_W,
    heightPx: SPRITE_H,
    alphaBbox: [0, 0, SPRITE_W, SPRITE_H],
    anchorPx: { x: SPRITE_W / 2, y: 0 },
    anchorSource: "default_bbox_top_center",
    mirrorable: false,
    physicalWidthMm: null,
  };
  const footprint = computeTransformedBoundingBox(transform, assetGeometry);
  const footprintCenterX = (footprint[0] + footprint[2]) / 2;
  const footprintCenterY = (footprint[1] + footprint[3]) / 2;

  const MASK_W = 32;
  const MASK_H = 32;

  it("footprint from the real geometry function lands where expected (sanity check before trusting the pixel result)", () => {
    // scale 0.3 on a 300x150 sprite -> roughly 90x45 rendered size, centered near the anchor.
    expect(footprint[2] - footprint[0]).toBeGreaterThan(60);
    expect(footprint[2] - footprint[0]).toBeLessThan(120);
    expect(footprintCenterX).toBeGreaterThan(80);
    expect(footprintCenterX).toBeLessThan(120);
  });

  it("hair covering the center of this realistically scaled+rotated necklace still erases it, real pixels", () => {
    const region = toMaskSpaceRegion(footprint, transform.anchorPx.y, OUTPUT_W, OUTPUT_H, MASK_W, MASK_H);
    // Mark the mask pixel(s) at the footprint's own center as hair -- guaranteed to be
    // inside the region regardless of the exact rotated shape, unlike a fixed
    // arbitrary row/column choice.
    const categoryData = new Uint8Array(MASK_W * MASK_H).fill(0);
    const centerMaskX = Math.round((footprintCenterX / OUTPUT_W) * MASK_W);
    const centerMaskY = Math.round((footprintCenterY / OUTPUT_H) * MASK_H);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = centerMaskX + dx;
        const y = centerMaskY + dy;
        if (x >= 0 && x < MASK_W && y >= 0 && y < MASK_H) categoryData[y * MASK_W + x] = 1; // hair
      }
    }
    const occlusionMask = computeNecklaceOcclusionMask(categoryData, MASK_W, MASK_H, region);
    const eraseRgba = buildOcclusionEraseRgba(occlusionMask);

    const eraseCanvas = createCanvas(MASK_W, MASK_H);
    const eraseCtx = eraseCanvas.getContext("2d");
    eraseCtx.putImageData(new NodeImageData(eraseRgba, MASK_W, MASK_H) as unknown as ImageData, 0, 0);

    const sprite = createCanvas(SPRITE_W, SPRITE_H);
    const spriteCtx = sprite.getContext("2d");
    spriteCtx.fillStyle = `rgb(${NECKLACE_GOLD[0]}, ${NECKLACE_GOLD[1]}, ${NECKLACE_GOLD[2]})`;
    spriteCtx.fillRect(0, 0, SPRITE_W, SPRITE_H);

    const scratchCanvas = createCanvas(OUTPUT_W, OUTPUT_H);
    const scratchCtx = scratchCanvas.getContext("2d");

    drawOccludedJewelleryOverlay(
      scratchCtx as unknown as CanvasRenderingContext2D,
      sprite as unknown as CanvasImageSource,
      transform,
      1,
      eraseCanvas as unknown as CanvasImageSource,
      MASK_W,
      MASK_H,
      OUTPUT_W,
      OUTPUT_H
    );

    // Before asserting erasure, confirm the necklace was actually drawn opaque at its
    // own center in the first place (otherwise "erased" would be a meaningless no-op
    // check against an already-blank pixel).
    const beforeCheckCanvas = createCanvas(OUTPUT_W, OUTPUT_H);
    const beforeCtx = beforeCheckCanvas.getContext("2d");
    beforeCtx.save();
    beforeCtx.translate(transform.anchorPx.x, transform.anchorPx.y);
    beforeCtx.rotate((transform.rotationDegrees * Math.PI) / 180);
    beforeCtx.scale(transform.scaleFactor, transform.scaleFactor);
    beforeCtx.drawImage(sprite, -transform.sourceAnchorPx.x, -transform.sourceAnchorPx.y);
    beforeCtx.restore();
    const [br, bg, bb, ba] = beforeCtx.getImageData(Math.round(footprintCenterX), Math.round(footprintCenterY), 1, 1).data;
    expect([br, bg, bb, ba]).toEqual([...NECKLACE_GOLD, 255]);

    const afterAlpha = scratchCtx.getImageData(Math.round(footprintCenterX), Math.round(footprintCenterY), 1, 1).data[3];
    expect(afterAlpha).toBeLessThan(50); // hair occludes it -- must be (near-)fully erased, not left opaque
  });
});
