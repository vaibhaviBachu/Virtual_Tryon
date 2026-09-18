/**
 * Live AR tracking-loss state machine.
 *
 * Milestone 5 spec requirement: "Do not remove jewellery instantly on a single bad
 * frame... implement a short grace period using the last known reliable transform...
 * after a longer timeout, fade jewellery out gracefully... never freeze the jewellery
 * indefinitely in an incorrect position."
 *
 * Three states:
 * - TRACKING_GOOD: the current frame produced a usable transform. Render it directly.
 * - TRACKING_DEGRADED: the current frame failed (no face/pose, low confidence, category
 *   not ready, etc.) but the last good transform is still within its grace period.
 *   Render the LAST reliable transform, frozen, at full opacity, so a single noisy frame
 *   or a brief occlusion does not make the jewellery flicker or vanish.
 * - TRACKING_LOST: the grace period has elapsed. The jewellery fades from full to zero
 *   opacity over `TRACKING_LOST_FADE_MS`, then stays hidden (never frozen on screen
 *   indefinitely) until a good frame arrives again, at which point the state returns to
 *   TRACKING_GOOD immediately (no re-acquisition delay -- reappearing promptly when the
 *   subject comes back into frame is more important than debouncing re-entry).
 *
 * This module is pure state/time bookkeeping -- it does not know about faces, poses, or
 * rendering. Callers feed it `update(nowMs, frameOk)` once per rendered frame.
 */
import { TRACKING_DEGRADED_GRACE_MS, TRACKING_LOST_FADE_MS } from "@/lib/live-ar/constants";
import type { TrackingStatus } from "@/lib/live-ar/types";

export interface TrackingStateResult<T> {
  status: TrackingStatus;
  /** The transform to actually render this frame: the fresh one on a good frame, the
   * frozen last-good one during DEGRADED/LOST (fading via `opacity` once LOST), or null
   * if there has never been a good frame yet. */
  transform: T | null;
  /** Multiply the jewellery layer's alpha by this. 1 = fully visible, 0 = fully hidden. */
  opacity: number;
}

export class TrackingStateMachine<T> {
  private lastGoodTransform: T | null = null;
  private lastGoodAtMs: number | null = null;

  constructor(
    private readonly degradedGraceMs: number = TRACKING_DEGRADED_GRACE_MS,
    private readonly lostFadeMs: number = TRACKING_LOST_FADE_MS
  ) {}

  /** Feed one frame's tracking result. `nowMs` should be a monotonically increasing
   * timestamp (e.g. `performance.now()`). `freshTransform` is the transform computed
   * this frame, or null if tracking failed (no face/pose, low confidence, category not
   * ready, asset not loaded, etc). */
  update(nowMs: number, freshTransform: T | null): TrackingStateResult<T> {
    if (freshTransform !== null) {
      this.lastGoodTransform = freshTransform;
      this.lastGoodAtMs = nowMs;
      return { status: "TRACKING_GOOD", transform: freshTransform, opacity: 1 };
    }

    if (this.lastGoodTransform === null || this.lastGoodAtMs === null) {
      // Never had a good frame at all -- nothing to hold onto or fade.
      return { status: "TRACKING_LOST", transform: null, opacity: 0 };
    }

    const elapsedMs = nowMs - this.lastGoodAtMs;
    if (elapsedMs <= this.degradedGraceMs) {
      return { status: "TRACKING_DEGRADED", transform: this.lastGoodTransform, opacity: 1 };
    }

    const fadeElapsedMs = elapsedMs - this.degradedGraceMs;
    if (fadeElapsedMs >= this.lostFadeMs) {
      return { status: "TRACKING_LOST", transform: this.lastGoodTransform, opacity: 0 };
    }

    const opacity = 1 - fadeElapsedMs / this.lostFadeMs;
    return { status: "TRACKING_LOST", transform: this.lastGoodTransform, opacity };
  }

  reset(): void {
    this.lastGoodTransform = null;
    this.lastGoodAtMs = null;
  }
}
