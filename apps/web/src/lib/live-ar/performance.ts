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
}

export interface PerformanceSnapshot {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  avgTrackingMs: number;
  avgGeometryMs: number;
  avgRenderMs: number;
  droppedFrameCount: number;
  sampleCount: number;
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
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[index];
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
    return {
      fps: avgFrameMs > 0 ? 1000 / avgFrameMs : 0,
      avgFrameMs,
      p95FrameMs: percentile95(frameTimes),
      avgTrackingMs: average(this.samples.map((s) => s.trackingMs)),
      avgGeometryMs: average(this.samples.map((s) => s.geometryMs)),
      avgRenderMs: average(this.samples.map((s) => s.renderMs)),
      droppedFrameCount: this.samples.filter((s) => s.droppedFrame).length,
      sampleCount: this.samples.length,
    };
  }

  reset(): void {
    this.samples = [];
  }
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
