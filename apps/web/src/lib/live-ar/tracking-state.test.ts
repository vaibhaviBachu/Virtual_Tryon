import { describe, expect, it } from "vitest";

import { TrackingStateMachine } from "@/lib/live-ar/tracking-state";

const DEGRADED_GRACE_MS = 600;
const LOST_FADE_MS = 250;

describe("TrackingStateMachine", () => {
  it("reports TRACKING_LOST with no transform before any good frame has ever arrived", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    const result = machine.update(0, null);
    expect(result.status).toBe("TRACKING_LOST");
    expect(result.transform).toBeNull();
    expect(result.opacity).toBe(0);
  });

  it("reports TRACKING_GOOD at full opacity on a good frame", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    const result = machine.update(0, 42);
    expect(result).toEqual({ status: "TRACKING_GOOD", transform: 42, opacity: 1 });
  });

  it("does not remove jewellery on a single bad frame -- stays DEGRADED with the last transform frozen", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    machine.update(0, 42);
    const result = machine.update(50, null); // one bad frame, well within the grace period
    expect(result.status).toBe("TRACKING_DEGRADED");
    expect(result.transform).toBe(42);
    expect(result.opacity).toBe(1);
  });

  it("returns to TRACKING_GOOD immediately once a good frame reappears during the grace period", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    machine.update(0, 42);
    machine.update(50, null);
    const result = machine.update(100, 99);
    expect(result).toEqual({ status: "TRACKING_GOOD", transform: 99, opacity: 1 });
  });

  it("stays DEGRADED right up to the edge of the grace period", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    machine.update(0, 42);
    const result = machine.update(DEGRADED_GRACE_MS, null);
    expect(result.status).toBe("TRACKING_DEGRADED");
    expect(result.opacity).toBe(1);
  });

  it("begins fading to TRACKING_LOST once the grace period elapses, reaching 0 opacity by the end of the fade window", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    machine.update(0, 42);

    const midFade = machine.update(DEGRADED_GRACE_MS + LOST_FADE_MS / 2, null);
    expect(midFade.status).toBe("TRACKING_LOST");
    expect(midFade.transform).toBe(42);
    expect(midFade.opacity).toBeCloseTo(0.5, 5);

    const afterFade = machine.update(DEGRADED_GRACE_MS + LOST_FADE_MS, null);
    expect(afterFade.status).toBe("TRACKING_LOST");
    expect(afterFade.opacity).toBe(0);
  });

  it("never freezes indefinitely -- stays at 0 opacity (not frozen mid-fade) long after loss", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    machine.update(0, 42);
    const farFuture = machine.update(DEGRADED_GRACE_MS + LOST_FADE_MS + 100000, null);
    expect(farFuture.status).toBe("TRACKING_LOST");
    expect(farFuture.opacity).toBe(0);
  });

  it("recovers to TRACKING_GOOD immediately even after fully fading out", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    machine.update(0, 42);
    machine.update(DEGRADED_GRACE_MS + LOST_FADE_MS + 5000, null);
    const result = machine.update(DEGRADED_GRACE_MS + LOST_FADE_MS + 6000, 7);
    expect(result).toEqual({ status: "TRACKING_GOOD", transform: 7, opacity: 1 });
  });

  it("full GOOD -> DEGRADED -> LOST -> GOOD cycle transitions in the expected order", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    const statuses: string[] = [];
    statuses.push(machine.update(0, 1).status);
    statuses.push(machine.update(100, null).status);
    statuses.push(machine.update(DEGRADED_GRACE_MS + LOST_FADE_MS + 1, null).status);
    statuses.push(machine.update(DEGRADED_GRACE_MS + LOST_FADE_MS + 2, 2).status);
    expect(statuses).toEqual(["TRACKING_GOOD", "TRACKING_DEGRADED", "TRACKING_LOST", "TRACKING_GOOD"]);
  });

  it("reset() clears the held transform so a subsequent bad frame reports LOST with no transform", () => {
    const machine = new TrackingStateMachine<number>(DEGRADED_GRACE_MS, LOST_FADE_MS);
    machine.update(0, 42);
    machine.reset();
    const result = machine.update(10, null);
    expect(result).toEqual({ status: "TRACKING_LOST", transform: null, opacity: 0 });
  });
});
