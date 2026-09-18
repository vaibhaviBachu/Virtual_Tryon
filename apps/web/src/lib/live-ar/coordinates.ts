/**
 * Coordinate systems and mirroring (Milestone 5 spec §7 — "This is critical").
 *
 * Four coordinate systems are in play for Live AR, and this file is the one place that
 * documents (and, via the accompanying tests, verifies) how they relate:
 *
 * 1. CAMERA coordinate system: the raw `<video>` element's decoded frame buffer —
 *    `videoWidth` x `videoHeight` pixels, top-left origin, x right / y down, NEVER
 *    mirrored. This is exactly the same "unmirrored capture" convention
 *    `ai/landmarks/schemas.py` documents for the photo pipeline (see that file's
 *    "COORDINATE CONVENTION" note) — Live AR does not introduce a new rule here, it
 *    reuses the existing one.
 * 2. TRACKING coordinate system: MediaPipe Tasks-Vision's `FaceLandmarker`/
 *    `PoseLandmarker` are given the raw (unmirrored) video frame as input, and return
 *    landmarks normalized to [0,1] in THAT SAME unmirrored frame's coordinate space —
 *    identical convention to `ai/landmarks/schemas.py`. `denormalize()` below is the
 *    only place normalized->pixel conversion happens (mirroring
 *    `ai/geometry/anchors.py`'s "spec §29: normalized -> pixel conversion happens ONLY
 *    here" rule into this module).
 * 3. RENDERING coordinate system: the jewellery `<canvas>` is sized to the SAME
 *    `videoWidth` x `videoHeight` as the camera coordinate system and draws using
 *    UNMIRRORED pixel coordinates straight out of `denormalize()` — i.e. geometry.ts
 *    never mirrors a point before computing an anchor/scale/rotation, and
 *    renderer.ts never mirrors a point before drawing. This is deliberate: it means
 *    the rendering coordinate system and the tracking coordinate system are IDENTICAL,
 *    eliminating an entire class of "did I mirror this point or not" bugs.
 * 4. DISPLAY coordinate system: what the user actually sees on screen. This is the ONE
 *    place mirroring happens, and it happens at the CSS/compositing layer, not in any
 *    coordinate math: `<video>` and `<canvas>` are both placed inside one wrapper
 *    element, and `MIRROR_TRANSFORM_CSS` is applied to that ONE wrapper (never to the
 *    video and canvas separately, and never to individual points) whenever the live
 *    preview is shown mirrored (the standard "looking in a mirror" selfie UX). Because
 *    the video and canvas are mirrored together as a single visual unit, a jewellery
 *    anchor computed and drawn in unmirrored space automatically lands on the correct
 *    (visually mirrored) side with zero coordinate transformation — this is what
 *    prevents the left/right earring bug the spec calls out explicitly.
 *
 * CAPTURE (spec §31/§32) reads pixels directly from the canvas/video's underlying pixel
 * buffers via `drawImage`/`getImageData`, which are UNAFFECTED by the CSS transform on
 * the wrapper — so a captured/saved image is always unmirrored, exactly matching
 * Milestone 3's established policy for photo try-on ("the actual captured frame must
 * NOT be mirrored... mirroring only the preview and not the capture is standard
 * practice" — ai/landmarks/schemas.py). Live AR does not invent a different rule for
 * captures than the photo flow already uses.
 */
import type { NormalizedPoint, PixelPoint } from "@/lib/live-ar/types";

/** The one CSS transform applied to the shared video+canvas wrapper for the natural
 * "looking in a mirror" preview UX. Never applied to the video or canvas individually. */
export const MIRROR_TRANSFORM_CSS = "scaleX(-1)";
export const NO_MIRROR_TRANSFORM_CSS = "none";

export function containerMirrorTransform(mirrored: boolean): string {
  return mirrored ? MIRROR_TRANSFORM_CSS : NO_MIRROR_TRANSFORM_CSS;
}

/** Normalized [0,1] top-left-origin -> pixel space. The ONLY place this conversion
 * happens (mirrors ai/geometry/anchors.py's rule) — every function downstream of this
 * (geometry.ts, renderer.ts) receives/produces pixel coordinates already. */
export function denormalize(point: NormalizedPoint, widthPx: number, heightPx: number): PixelPoint {
  return { x: point.x * widthPx, y: point.y * heightPx };
}

/**
 * Text (or any inherently-asymmetric glyph) drawn directly onto a canvas that sits
 * inside a mirrored wrapper renders backwards, because the CSS mirror flips it along
 * with everything else — unlike a jewellery texture (which is symmetric-ish and
 * anchored/rotated procedurally), readable UI text drawn onto that same canvas needs
 * to be counter-mirrored so it reads correctly. This is the one legitimate case where a
 * single point/transform needs mirroring math instead of relying on the wrapper.
 * `canvasWidthPx` is the canvas's own pixel width (same space as `denormalize`'s output).
 */
export function mirrorXInCanvasSpace(xPx: number, canvasWidthPx: number): number {
  return canvasWidthPx - xPx;
}
