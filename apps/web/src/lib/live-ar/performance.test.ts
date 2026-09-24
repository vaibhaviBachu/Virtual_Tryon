import { describe, expect, it } from "vitest";

import { PerformanceTracker, computeTimingStats, formatPerformanceOverlayText, formatTrackingBreakdownText } from "@/lib/live-ar/performance";

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
      segmentation: { sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 },
      occlusion: { sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 },
      faceDetect: { sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 },
      poseDetect: { sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 },
      alphaMask: { sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 },
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

  // M6.3 (docs/live-ar-realism-architecture.md §8/§10/§17).
  describe("segmentation timing (M6.3)", () => {
    it("reports all-zero segmentation stats when no frame ever carried a segmentationMs (unchanged pre-M6.3 behavior)", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample());
      tracker.record(sample());
      expect(tracker.snapshot().segmentation).toEqual({ sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 });
    });

    it("excludes cadence-skipped frames (null/undefined segmentationMs) from segmentation stats entirely, rather than counting them as 0ms", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample({ segmentationMs: 80 }));
      tracker.record(sample({ segmentationMs: null })); // skipped this frame
      tracker.record(sample()); // segmentationMs omitted entirely -- same as null
      tracker.record(sample({ segmentationMs: 100 }));
      const stats = tracker.snapshot().segmentation;
      expect(stats.sampleCount).toBe(2); // NOT 4 -- the two skipped frames don't count
      expect(stats.avgMs).toBeCloseTo(90, 6);
      expect(stats.minMs).toBe(80);
      expect(stats.maxMs).toBe(100);
    });
  });

  // M6.4 (docs/live-ar-realism-architecture.md §17) -- identical convention to
  // segmentation timing above, kept as its own independent stat.
  describe("occlusion timing (M6.4)", () => {
    it("reports all-zero occlusion stats when no frame ever carried an occlusionMs", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample({ segmentationMs: 200 })); // segmentation ran, occlusion did not
      expect(tracker.snapshot().occlusion).toEqual({ sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 });
    });

    it("tracks occlusion timing independently of segmentation timing", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample({ segmentationMs: 200, occlusionMs: 2 }));
      tracker.record(sample({ segmentationMs: null, occlusionMs: 3 }));
      const snapshot = tracker.snapshot();
      expect(snapshot.segmentation.sampleCount).toBe(1);
      expect(snapshot.occlusion.sampleCount).toBe(2);
      expect(snapshot.occlusion.avgMs).toBeCloseTo(2.5, 6);
    });
  });

  // M6.4 real-device review (2026-09-24) Step 12: split the combined trackingMs into
  // its two real components.
  describe("face/pose detection timing breakdown (M6.4 real-device review)", () => {
    it("reports all-zero when no frame ever carried faceDetectMs/poseDetectMs", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample());
      const snapshot = tracker.snapshot();
      expect(snapshot.faceDetect.sampleCount).toBe(0);
      expect(snapshot.poseDetect.sampleCount).toBe(0);
    });

    it("tracks face and pose detection timing independently", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample({ faceDetectMs: 60, poseDetectMs: 40 }));
      tracker.record(sample({ faceDetectMs: 80, poseDetectMs: 30 }));
      const snapshot = tracker.snapshot();
      expect(snapshot.faceDetect.avgMs).toBeCloseTo(70, 6);
      expect(snapshot.poseDetect.avgMs).toBeCloseTo(35, 6);
    });
  });

  // 2026-09-24 controlled real-device validation Step 13: measure the cost of the new
  // jewellery-alpha rendering/downscaling step, separately from occlusionMs.
  describe("jewellery alpha mask timing (controlled real-device validation)", () => {
    it("reports all-zero when no frame ever carried alphaMaskMs", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample({ occlusionMs: 2 }));
      expect(tracker.snapshot().alphaMask.sampleCount).toBe(0);
    });

    it("tracks alpha-mask timing independently of occlusion compositing timing", () => {
      const tracker = new PerformanceTracker();
      tracker.record(sample({ alphaMaskMs: 1.5, occlusionMs: 2.5 }));
      const snapshot = tracker.snapshot();
      expect(snapshot.alphaMask.avgMs).toBeCloseTo(1.5, 6);
      expect(snapshot.occlusion.avgMs).toBeCloseTo(2.5, 6);
    });
  });
});

describe("formatTrackingBreakdownText", () => {
  it("reports 'no samples yet' before any face/pose timing has been recorded", () => {
    const tracker = new PerformanceTracker();
    tracker.record(sample());
    expect(formatTrackingBreakdownText(tracker.snapshot())).toBe("Tracking breakdown: no samples yet");
  });

  it("formats real face/pose timing stats once recorded", () => {
    const tracker = new PerformanceTracker();
    tracker.record(sample({ faceDetectMs: 60.4, poseDetectMs: 40.1 }));
    const text = formatTrackingBreakdownText(tracker.snapshot());
    expect(text).toContain("Face: n=1 avg=60.4ms");
    expect(text).toContain("Pose: n=1 avg=40.1ms");
  });
});

describe("computeTimingStats", () => {
  it("returns all-zero stats (sampleCount 0) for an empty set -- never a fabricated number", () => {
    expect(computeTimingStats([])).toEqual({ sampleCount: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 });
  });

  it("computes real average/median/min/max from a small hand-checkable set", () => {
    const stats = computeTimingStats([10, 20, 30, 40, 50]);
    expect(stats.sampleCount).toBe(5);
    expect(stats.avgMs).toBeCloseTo(30, 6);
    expect(stats.medianMs).toBe(30);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(50);
  });

  it("computes the median as the average of the two middle values for an even-sized set", () => {
    expect(computeTimingStats([10, 20, 30, 40]).medianMs).toBe(25);
  });

  it("computes p95 from the actual distribution, matching PerformanceTracker's own p95FrameMs formula", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(computeTimingStats(values).p95Ms).toBe(95);
  });

  it("is order-independent (does not mutate or depend on input ordering)", () => {
    const unordered = [50, 10, 40, 20, 30];
    const stats = computeTimingStats(unordered);
    expect(unordered).toEqual([50, 10, 40, 20, 30]); // input array untouched
    expect(stats.medianMs).toBe(30);
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
