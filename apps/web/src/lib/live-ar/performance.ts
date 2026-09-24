/**
 * Live AR performance instrumentation -- spec §24/§34: "measure camera FPS, tracking
 * FPS, geometry computation time, render time, dropped frames, tracking-loss events...
 * do not claim an FPS number without measuring it." This module only records real
 * timings callers hand it (typically from `performance.now()` around each pipeline
 * stage); it never estimates or fabricates a number.
 *
 * Kept UI-framework-agnostic and canvas-agnostic on purpose so it can back both the
 * developer-only on-screen overlay (spec §23) and the headless performance-testing
 * harness (spec §35) from the same recorded data.
 */

export interface FrameSample {
  totalFrameMs: number;
  trackingMs: number;
  geometryMs: number;
  renderMs: number;
  droppedFrame: boolean;
  /** M6.3 (docs/live-ar-realism-architecture.md §8/§10/§17): this frame's segmentation
   * inference time, or `null`/`undefined` when segmentation did NOT run this frame
   * (cadence-throttled -- see segmentation.ts's SegmentationCadenceScheduler). A
   * skipped frame is excluded from the segmentation stats entirely, never counted as a
   * 0ms sample -- mixing those in would understate the real per-inference cost.
   * Optional so every pre-M6.3 caller/fixture keeps compiling and behaving unchanged. */
  segmentationMs?: number | null;
  /** M6.4 real-device review (2026-09-24) Step 12: the combined `trackingMs` above is
   * FaceLandmarker + PoseLandmarker together -- these split it so a real device can
   * show which one actually dominates instead of guessing. Optional/nullable for the
   * same reason segmentationMs/occlusionMs are -- old callers keep compiling. */
  faceDetectMs?: number | null;
  poseDetectMs?: number | null;
  /** M6.4 (docs/live-ar-realism-architecture.md §17): this frame's occlusion
   * compositing time (computing the occlusion mask + the destination-out erase draw),
   * or `null`/`undefined` on a frame where no occlusion was attempted (no necklace
   * overlay this frame, no fresh-enough mask, etc.) -- same "exclude, don't count as
   * 0ms" convention as `segmentationMs` above. */
  occlusionMs?: number | null;
  /** 2026-09-24 controlled real-device validation Step 13: the cost of rendering the
   * jewellery's own alpha silhouette + downscaling it to mask resolution (the new
   * per-frame work this correction adds) -- measured separately from `occlusionMs`
   * (which is category-mask + erase compositing) so the two costs are never conflated,
   * per that step's explicit "measure the cost... do not introduce an expensive
   * operation without measuring it." Same exclude-don't-zero convention as the others. */
  alphaMaskMs?: number | null;
}

/** Real min/median/average/p95/max over a set of real recorded timings -- Step 10's
 * explicit ask ("sample count, average, median, p95, minimum, maximum. Do not
 * estimate."). All-zero (with sampleCount 0) when there are no samples yet, which is
 * how "not measured" is represented -- never a fabricated placeholder number. */
export interface TimingStats {
  sampleCount: number;
  avgMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

const EMPTY_TIMING_STATS: TimingStats = { sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 };

export interface PerformanceSnapshot {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  avgTrackingMs: number;
  avgGeometryMs: number;
  avgRenderMs: number;
  droppedFrameCount: number;
  sampleCount: number;
  /** M6.3: real segmentation inference timing, computed ONLY from frames where
   * segmentation actually ran (see FrameSample.segmentationMs above). */
  segmentation: TimingStats;
  /** M6.4: real occlusion compositing timing, computed ONLY from frames where
   * occlusion was actually attempted (see FrameSample.occlusionMs above). */
  occlusion: TimingStats;
  /** M6.4 real-device review Step 12: FaceLandmarker/PoseLandmarker split out of the
   * combined `avgTrackingMs`/frame-total figure above. */
  faceDetect: TimingStats;
  poseDetect: TimingStats;
  /** 2026-09-24 controlled real-device validation Step 13: see FrameSample.alphaMaskMs. */
  alphaMask: TimingStats;
}

const EMPTY_SNAPSHOT: PerformanceSnapshot = {
  fps: 0,
  avgFrameMs: 0,
  p95FrameMs: 0,
  avgTrackingMs: 0,
  avgGeometryMs: 0,
  avgRenderMs: 0,
  droppedFrameCount: 0,
  sampleCount: 0,
  segmentation: EMPTY_TIMING_STATS,
  occlusion: EMPTY_TIMING_STATS,
  faceDetect: EMPTY_TIMING_STATS,
  poseDetect: EMPTY_TIMING_STATS,
  alphaMask: EMPTY_TIMING_STATS,
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index];
}

function percentile95(values: number[]): number {
  return percentile(values, 0.95);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** M6.3: real min/median/avg/p95/max over a set of timings, or all-zero (sampleCount 0)
 * for an empty set -- see TimingStats's own doc comment for why that's the honest
 * representation of "nothing measured yet," not a fabricated number. */
export function computeTimingStats(values: number[]): TimingStats {
  if (values.length === 0) return EMPTY_TIMING_STATS;
  return {
    sampleCount: values.length,
    avgMs: average(values),
    medianMs: median(values),
    p95Ms: percentile95(values),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}

/** Keeps a rolling window of the most recent frame samples (default: ~2 seconds at 30
 * FPS) rather than an all-time average, so the overlay reflects CURRENT performance,
 * not performance averaged over an entire long session. */
export class PerformanceTracker {
  private samples: FrameSample[] = [];

  constructor(private readonly windowSize: number = 60) {}

  record(sample: FrameSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
  }

  snapshot(): PerformanceSnapshot {
    if (this.samples.length === 0) return EMPTY_SNAPSHOT;
    const frameTimes = this.samples.map((s) => s.totalFrameMs);
    const avgFrameMs = average(frameTimes);
    const segmentationTimes = this.samples
      .map((s) => s.segmentationMs)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    const occlusionTimes = this.samples
      .map((s) => s.occlusionMs)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    const faceDetectTimes = this.samples
      .map((s) => s.faceDetectMs)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    const poseDetectTimes = this.samples
      .map((s) => s.poseDetectMs)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    const alphaMaskTimes = this.samples
      .map((s) => s.alphaMaskMs)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    return {
      fps: avgFrameMs > 0 ? 1000 / avgFrameMs : 0,
      avgFrameMs,
      p95FrameMs: percentile95(frameTimes),
      avgTrackingMs: average(this.samples.map((s) => s.trackingMs)),
      avgGeometryMs: average(this.samples.map((s) => s.geometryMs)),
      avgRenderMs: average(this.samples.map((s) => s.renderMs)),
      droppedFrameCount: this.samples.filter((s) => s.droppedFrame).length,
      sampleCount: this.samples.length,
      segmentation: computeTimingStats(segmentationTimes),
      occlusion: computeTimingStats(occlusionTimes),
      faceDetect: computeTimingStats(faceDetectTimes),
      poseDetect: computeTimingStats(poseDetectTimes),
      alphaMask: computeTimingStats(alphaMaskTimes),
    };
  }

  reset(): void {
    this.samples = [];
  }
}

/** M6.3: plain-text rendering of the segmentation debug status/timing line -- kept as
 * its own simple function (rather than an inline JSX expression) so the calling
 * component only ever does one property access per argument, matching this file's
 * existing `formatPerformanceOverlayText` convention below. */
export function formatSegmentationDebugText(
  status: "idle" | "loading" | "ready" | "error",
  error: string | null,
  stats: TimingStats
): string {
  const base = `Segmentation: ${status}` + (error ? ` (${error})` : "");
  if (stats.sampleCount === 0) return `${base} / no samples yet`;
  return (
    `${base} / n=${stats.sampleCount} ` +
    `avg=${stats.avgMs.toFixed(1)}ms p95=${stats.p95Ms.toFixed(1)}ms ` +
    `min=${stats.minMs.toFixed(1)}ms max=${stats.maxMs.toFixed(1)}ms`
  );
}

/** M6.4: plain-text rendering of the occlusion debug status/timing line, kept as its
 * own simple function for the same reason `formatSegmentationDebugText` above is --
 * one property access per argument at the call site, not a complex inline expression.
 * `trackingStatus` is accepted as a plain string (not importing types.ts's
 * `TrackingStatus` here) to keep this file's existing zero-dependency,
 * framework-agnostic status (see this file's header docstring). */
export function formatOcclusionDebugText(
  info: { maskAgeMs: number | null; isStale: boolean; trackingStatus: string; occlusionActive: boolean } | null,
  stats: TimingStats
): string {
  // M6.4 real-device verification (2026-09-24) Step 2 item I: "whether occlusion is
  // currently active" must be its own explicit, unmissable word (ACTIVE/INACTIVE), not
  // something the reader has to infer from the mask-age/staleness text alone.
  if (info === null) return "Occlusion: INACTIVE (no necklace overlay this frame)";
  const ageText =
    info.maskAgeMs === null ? "no mask yet" : `${info.maskAgeMs.toFixed(0)}ms old${info.isStale ? " (STALE)" : ""}`;
  const timingText =
    stats.sampleCount > 0
      ? ` / compositing: n=${stats.sampleCount} avg=${stats.avgMs.toFixed(2)}ms p95=${stats.p95Ms.toFixed(2)}ms`
      : " / compositing: no samples yet";
  const activeText = info.occlusionActive ? "ACTIVE" : "INACTIVE";
  return `Occlusion: ${activeText} / tracking=${info.trackingStatus} mask age=${ageText}${timingText}`;
}

/** Formats a snapshot the way spec §23's example overlay does:
 * "FPS: 29 / Tracking: 8ms / Geometry: 0.4ms / Render: 2ms / Total: 10.4ms". Real
 * measured numbers only -- never called before at least one frame has been recorded. */
export function formatPerformanceOverlayText(snapshot: PerformanceSnapshot): string {
  const totalMs = snapshot.avgTrackingMs + snapshot.avgGeometryMs + snapshot.avgRenderMs;
  return (
    `FPS: ${snapshot.fps.toFixed(0)} / ` +
    `Tracking: ${snapshot.avgTrackingMs.toFixed(1)}ms / ` +
    `Geometry: ${snapshot.avgGeometryMs.toFixed(1)}ms / ` +
    `Render: ${snapshot.avgRenderMs.toFixed(1)}ms / ` +
    `Total: ${totalMs.toFixed(1)}ms`
  );
}

/** M6.4 real-device review (2026-09-24) Step 12: breaks the combined `avgTrackingMs`
 * above into its two real components. Kept as a SEPARATE function (not merged into
 * `formatPerformanceOverlayText`) so that function's existing spec-quoted output
 * format stays exactly as documented, rather than growing a second, different-shaped
 * line under the same name. */
export function formatTrackingBreakdownText(snapshot: PerformanceSnapshot): string {
  if (snapshot.faceDetect.sampleCount === 0 && snapshot.poseDetect.sampleCount === 0) {
    return "Tracking breakdown: no samples yet";
  }
  return (
    `Tracking breakdown -- ` +
    `Face: n=${snapshot.faceDetect.sampleCount} avg=${snapshot.faceDetect.avgMs.toFixed(1)}ms p95=${snapshot.faceDetect.p95Ms.toFixed(1)}ms / ` +
    `Pose: n=${snapshot.poseDetect.sampleCount} avg=${snapshot.poseDetect.avgMs.toFixed(1)}ms p95=${snapshot.poseDetect.p95Ms.toFixed(1)}ms`
  );
}
