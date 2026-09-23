/**
 * MediaPipe multiclass ImageSegmenter -- M6.3 proof of concept
 * (docs/live-ar-realism-architecture.md §6/§8/§17). Loads and runs Google's
 * "Multiclass Selfie Segmenter" (`selfie_multiclass_256x256`, Apache-2.0 -- see
 * ai/models/LICENSES.md) entirely in the browser, via the exact same
 * `@mediapipe/tasks-vision` package and WASM fileset URL `tracking.ts` already uses
 * successfully in production for FaceLandmarker/PoseLandmarker.
 *
 * THIS MILESTONE DOES NOT IMPLEMENT OCCLUSION. Nothing here changes what jewellery
 * renders or where -- this module only produces a category mask for a
 * development-only debug visualization (see `drawSegmentationDebugOverlay` in
 * renderer.ts). Occlusion is M6.4, gated on review of this milestone's real-device
 * results (see docs/live-ar-realism-verification.md's M6.3 section).
 *
 * VERSION CONSISTENCY (the M6.1 audit's open question, resolved for THIS milestone):
 * `ImageSegmenter` is loaded via `FilesetResolver.forVisionTasks(WASM_FILESET_URL)` --
 * the IDENTICAL fileset URL (CDN-pinned to tasks-vision@0.10.14) tracking.ts already
 * uses for FaceLandmarker/PoseLandmarker in production today. ImageSegmenter ships in
 * the same generic Tasks-Vision WASM bundle as every other vision task; there is no
 * version-specific reason to expect it to behave differently on that same fileset, and
 * this milestone deliberately does not touch WASM_FILESET_URL (upgrading MediaPipe was
 * explicitly out of scope for this milestone). If a real device reveals a genuine
 * incompatibility, that is new evidence -- record it in
 * docs/live-ar-realism-verification.md's M6.3 section rather than assumed away here.
 *
 * MASK RESOLUTION (Step 8 alignment): the model outputs a category mask at its OWN
 * native resolution (256x256 for this model) -- NOT the video's resolution. The debug
 * overlay (renderer.ts's `drawSegmentationDebugOverlay`) scales it up to the video's
 * actual pixel size using Canvas 2D's own `drawImage` scaling, in the SAME unmirrored
 * canvas coordinate space tracking/jewellery already use. No independent mirroring
 * logic is added here (Step 9) -- the existing single CSS mirror transform on the
 * shared video+canvas wrapper (coordinates.ts) already covers this overlay too, exactly
 * as it already does for the jewellery sprite and the necklace debug overlay.
 */
import { FilesetResolver, ImageSegmenter, type ImageSegmenterResult } from "@mediapipe/tasks-vision";

const WASM_FILESET_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
// Verified against Google's own Image Segmentation guide (see Sources in
// docs/live-ar-realism-architecture.md): a raw .tflite asset, loaded directly via
// baseOptions.modelAssetPath -- unlike FaceLandmarker/PoseLandmarker's bundled .task
// files, ImageSegmenter's own official web sample loads a bare .tflite the same way.
const SEGMENTATION_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

/** The exact category index -> label mapping for `selfie_multiclass_256x256`, verified
 * against Google's own Image Segmentation guide (see Sources in
 * docs/live-ar-realism-architecture.md) -- not assumed from the class name alone. This
 * is the one place that mapping is defined; every other module imports it rather than
 * re-declaring its own copy. */
export const SEGMENTATION_CATEGORY_LABELS: readonly string[] = [
  "background", // 0
  "hair", // 1
  "body-skin", // 2
  "face-skin", // 3
  "clothes", // 4
  "others", // 5
];

export interface LiveSegmenter {
  segmenter: ImageSegmenter;
  close(): void;
}

/** Initializes the segmenter once per Live AR session -- never call this per frame (see
 * tracking.ts's `createLiveTrackers` for the identical one-time-load rationale). GPU
 * delegate matches the existing FaceLandmarker/PoseLandmarker choice; Google's own
 * published benchmark for this model shows GPU meaningfully faster than CPU (see
 * constants.ts's SEGMENTATION_INTERVAL_MS_DEFAULT comment for the actual numbers). */
export async function createLiveSegmenter(): Promise<LiveSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_FILESET_URL);
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: SEGMENTATION_MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    outputCategoryMask: true,
    // Confidence masks are 6 extra float32 masks per frame this milestone has no use
    // for (only the single-byte-per-pixel category index is needed for the debug
    // overlay) -- explicitly disabled rather than left to the (also-false) default, so
    // the intent is visible in the code, not just inherited silently.
    outputConfidenceMasks: false,
  });
  return { segmenter, close: () => segmenter.close() };
}

export interface SegmentationResult {
  /** One byte per pixel, each an index into SEGMENTATION_CATEGORY_LABELS, at the
   * mask's OWN native resolution (see file docstring -- NOT the video's resolution). */
  categoryData: Uint8Array;
  maskWidthPx: number;
  maskHeightPx: number;
}

/** Pure conversion from a raw ImageSegmenterResult-shaped object into our
 * SegmentationResult, mirroring tracking.ts's toLiveFaceLandmarks/toLivePoseLandmarks
 * convention: no MediaPipe inference happens here, only reading a result object's own
 * shape, so this is unit-testable with a hand-built fixture (segmentation.test.ts) --
 * never a fabricated model load. Returns null when there is no category mask, exactly
 * like the landmark converters return null for "nothing detected." */
export function toSegmentationResult(result: ImageSegmenterResult): SegmentationResult | null {
  const mask = result.categoryMask;
  if (!mask) return null;
  return { categoryData: mask.getAsUint8Array(), maskWidthPx: mask.width, maskHeightPx: mask.height };
}

/** Runs one segmentation inference against the current video frame. Returns null --
 * NEVER throws -- on any failure (model not ready, invalid frame, internal MediaPipe
 * error): Step 17 requires that a segmentation failure never crashes the live jewellery
 * session, so this is the one place that boundary is enforced. Not unit-tested directly
 * (same as tracking.ts's `detectFrame`) since it requires a real loaded segmenter --
 * the meaningful logic it delegates to (`toSegmentationResult`) is tested on its own. */
export function runSegmentation(live: LiveSegmenter, video: HTMLVideoElement, timestampMs: number): SegmentationResult | null {
  try {
    const result = live.segmenter.segmentForVideo(video, timestampMs);
    return toSegmentationResult(result);
  } catch {
    return null;
  }
}

/**
 * Decides, per rendered frame, whether it is time to run a new (expensive) segmentation
 * inference, or reuse the last known result (Step 6/14: "the segmentation result can
 * remain unchanged between inference frames; the jewellery tracking must continue
 * independently"). Pure time-based state -- no MediaPipe/Canvas/React dependency, so
 * fully unit-testable with hand-built timestamps (no real camera/model needed).
 */
export class SegmentationCadenceScheduler {
  private lastRunAtMs: number | null = null;
  private latestResult: SegmentationResult | null = null;
  // M6.4 (docs/live-ar-realism-architecture.md §17): tracked SEPARATELY from
  // lastRunAtMs above, which advances on every run attempt (successful or not) to
  // drive the cadence timer. This field only advances when a run actually SUCCEEDS, so
  // "how old is the mask I'm currently using" (getLatestAgeMs) stays correct even
  // across one or more consecutive failed runs -- lastRunAtMs alone would understate
  // staleness in that case.
  private latestResultAtMs: number | null = null;

  constructor(private readonly intervalMs: number) {}

  /** True when at least `intervalMs` has elapsed since the last run, or this is the
   * very first frame. Does not run inference itself or mutate any state -- the caller
   * decides what to do with the answer (tracking/geometry/render keep running at the
   * full RAF rate regardless of this scheduler's answer). */
  shouldRun(nowMs: number): boolean {
    return this.lastRunAtMs === null || nowMs - this.lastRunAtMs >= this.intervalMs;
  }

  /** Records that a run happened at `nowMs` (successful or not -- a repeatedly-failing
   * segmenter is retried on the normal cadence, never spammed every frame just because
   * it keeps failing) and, when `result` is non-null, replaces the stale "latest"
   * result with this fresh one and records `nowMs` as when THAT result was captured. */
  recordRun(nowMs: number, result: SegmentationResult | null): void {
    this.lastRunAtMs = nowMs;
    if (result !== null) {
      this.latestResult = result;
      this.latestResultAtMs = nowMs;
    }
  }

  /** The most recent successful result, or null if none has ever succeeded. Every
   * frame between inference runs reuses this exact object -- Step 14's "stale-mask
   * reuse," never a fresh allocation per skipped frame. */
  getLatest(): SegmentationResult | null {
    return this.latestResult;
  }

  /** How old the current latest result is, in ms, as of `nowMs` -- null when no
   * result has ever succeeded (nothing to be "old"). Callers (occlusion.ts) compare
   * this against OCCLUSION_STALE_MASK_THRESHOLD_MS to decide whether to keep using it. */
  getLatestAgeMs(nowMs: number): number | null {
    if (this.latestResultAtMs === null) return null;
    return nowMs - this.latestResultAtMs;
  }

  reset(): void {
    this.lastRunAtMs = null;
    this.latestResult = null;
    this.latestResultAtMs = null;
  }
}

/** One RGBA byte quadruple per category index, chosen only to be visibly distinct from
 * each other in a debug overlay -- not a claimed "correct" or final color scheme. */
const SEGMENTATION_DEBUG_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], // 0 background (fully transparent below -- see alpha handling)
  [255, 105, 180], // 1 hair
  [255, 205, 148], // 2 body-skin
  [255, 224, 189], // 3 face-skin
  [80, 160, 255], // 4 clothes
  [180, 80, 255], // 5 others
];
const SEGMENTATION_DEBUG_NON_BACKGROUND_ALPHA = 160;

/** Pure category-index -> colorized RGBA conversion, for the debug-only mask
 * visualization (Step 7). Deliberately has NO Canvas/ImageData/DOM dependency, unlike
 * the actual on-screen draw (renderer.ts's `drawSegmentationDebugOverlay`) -- this
 * project's jsdom test environment has no real `getContext("2d")`/`ImageData`
 * implementation (verified directly, not assumed), so keeping the color-mapping logic
 * itself DOM-free is what makes it possible to unit-test at all. Background (index 0)
 * is fully transparent so the camera frame still shows through; every other category
 * gets a fixed, semi-opaque color so more than one category's boundary can be read at
 * once. An out-of-range byte (never expected from the real model, but not assumed
 * impossible) falls back to the last defined color rather than throwing or reading
 * undefined. */
export function buildSegmentationDebugRgba(categoryData: Uint8Array, maskWidthPx: number, maskHeightPx: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(maskWidthPx * maskHeightPx * 4);
  for (let i = 0; i < categoryData.length; i++) {
    const category = categoryData[i];
    const color = SEGMENTATION_DEBUG_COLORS[category] ?? SEGMENTATION_DEBUG_COLORS[SEGMENTATION_DEBUG_COLORS.length - 1];
    const offset = i * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = category === 0 ? 0 : SEGMENTATION_DEBUG_NON_BACKGROUND_ALPHA;
  }
  return rgba;
}
