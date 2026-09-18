import { describe, expect, it } from "vitest";

import { PerformanceTracker, formatPerformanceOverlayText } from "@/lib/live-ar/performance";

function sample(overrides: Partial<Parameters<PerformanceTracker["record"]>[0]> = {}) {
  return { totalFrameMs: 33.3, trackingMs: 8, geometryMs: 0.4, renderMs: 2, droppedFrame: false, ...overrides };
}

describe("PerformanceTracker", () => {
  it("returns an all-zero snapshot before any frame is recorded", () => {
    const tracker = new PerformanceTracker();
    expect(tracker.snapshot()).toEqual({
      fps: 0,
      avgFrameMs: 0,
      p95FrameMs: 0,
      avgTrackingMs: 0,
      avgGeometryMs: 0,
      avgRenderMs: 0,
      droppedFrameCount: 0,
      sampleCount: 0,
    });
  });

  it("computes FPS from real recorded frame times, never a fabricated constant", () => {
    const tracker = new PerformanceTracker();
    for (let i = 0; i < 10; i++) tracker.record(sample({ totalFrameMs: 1000 / 30 }));
    const snapshot = tracker.snapshot();
    expect(snapshot.fps).toBeCloseTo(30, 1);
    expect(snapshot.sampleCount).toBe(10);
  });

  it("only keeps the most recent `windowSize` samples (current performance, not all-time average)", () => {
    const tracker = new PerformanceTracker(5);
    for (let i = 0; i < 5; i++) tracker.record(sample({ totalFrameMs: 100 })); // very slow, old
    for (let i = 0; i < 5; i++) tracker.record(sample({ totalFrameMs: 1000 / 30 })); // fast, recent
    const snapshot = tracker.snapshot();
    expect(snapshot.sampleCount).toBe(5);
    expect(snapshot.fps).toBeCloseTo(30, 1);
  });

  it("counts dropped frames", () => {
    const tracker = new PerformanceTracker();
    tracker.record(sample({ droppedFrame: true }));
    tracker.record(sample({ droppedFrame: false }));
    tracker.record(sample({ droppedFrame: true }));
    expect(tracker.snapshot().droppedFrameCount).toBe(2);
  });

  it("computes a p95 frame time from the actual distribution", () => {
    const tracker = new PerformanceTracker(100);
    for (let i = 1; i <= 100; i++) tracker.record(sample({ totalFrameMs: i }));
    expect(tracker.snapshot().p95FrameMs).toBe(95);
  });

  it("reset() clears all recorded samples", () => {
    const tracker = new PerformanceTracker();
    tracker.record(sample());
    tracker.reset();
    expect(tracker.snapshot().sampleCount).toBe(0);
  });
});

describe("formatPerformanceOverlayText", () => {
  it("matches the spec's example overlay format", () => {
    const tracker = new PerformanceTracker();
    tracker.record({ totalFrameMs: 1000 / 29, trackingMs: 8, geometryMs: 0.4, renderMs: 2, droppedFrame: false });
    const text = formatPerformanceOverlayText(tracker.snapshot());
    expect(text).toBe("FPS: 29 / Tracking: 8.0ms / Geometry: 0.4ms / Render: 2.0ms / Total: 10.4ms");
  });
});
