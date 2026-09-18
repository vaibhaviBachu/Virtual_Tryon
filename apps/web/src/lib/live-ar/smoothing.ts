/**
 * Live AR tracking smoothing.
 *
 * Milestone 5 spec requirement: "a configurable smoothing layer (EMA, One Euro, or a
 * simple Kalman-like filter)... choose the simplest approach that provides stable
 * results... must not introduce excessive lag... parameters must be configurable and
 * documented."
 *
 * CHOICE: exponential moving average (EMA) with a time-constant (not a fixed per-frame
 * alpha), applied independently to each scalar component of a LiveTransform (anchor x,
 * anchor y, scale, rotation). Rationale:
 *
 * - A time-constant-based EMA (`alpha = 1 - exp(-dt / tau)`) adapts automatically to
 *   variable frame intervals (camera FPS is not guaranteed constant), unlike a fixed
 *   per-frame alpha tuned for one assumed frame rate.
 * - One Euro and Kalman filters give better jitter/lag trade-offs at high velocity, but
 *   need per-axis velocity estimation and more tuning surface than this v1 needs. EMA is
 *   the simplest filter that visibly removes single-frame landmark jitter without adding
 *   noticeable lag at the target 24-30 FPS, which is what the spec asks for.
 * - Rotation is smoothed via its unwrapped degrees value (see `smoothAngleDegrees`) so a
 *   crossing of the -180/180 boundary does not snap or spin the jewellery.
 *
 * TRADE-OFF (documented honestly, see docs/live-ar-architecture.md): a plain EMA lags
 * behind fast motion more than a velocity-aware filter (One Euro) would. The default time
 * constant (`DEFAULT_SMOOTHING_TIME_CONSTANT_MS`) is tuned to be barely noticeable at
 * normal try-on movement speeds (slow head turns, standing still) while still killing
 * per-frame tracking noise. It is exposed as a constructor parameter specifically so this
 * can be revisited without changing the smoothing architecture.
 */
import { DEFAULT_SMOOTHING_TIME_CONSTANT_MS } from "@/lib/live-ar/constants";

/** alpha in (0, 1]: how much of the NEW sample to take on this update. */
export function emaAlphaForDt(dtMs: number, timeConstantMs: number): number {
  if (timeConstantMs <= 0) return 1;
  if (dtMs <= 0) return 0;
  return 1 - Math.exp(-dtMs / timeConstantMs);
}

export class ScalarEmaSmoother {
  private value: number | null = null;
  constructor(private readonly timeConstantMs: number = DEFAULT_SMOOTHING_TIME_CONSTANT_MS) {}

  /** Feed a new raw sample; returns the smoothed value. `dtMs` is time since the last
   * update (ignored, and the raw value is taken as-is, on the very first sample). */
  update(rawValue: number, dtMs: number): number {
    if (this.value === null) {
      this.value = rawValue;
      return this.value;
    }
    const alpha = emaAlphaForDt(dtMs, this.timeConstantMs);
    this.value = this.value + alpha * (rawValue - this.value);
    return this.value;
  }

  reset(): void {
    this.value = null;
  }

  get current(): number | null {
    return this.value;
  }
}

/** Smooths an angle in degrees, unwrapping across the -180/180 boundary first so e.g.
 * 179deg -> -179deg (a 2deg motion) is smoothed as a 2deg step, not a 358deg swing. */
export class AngleEmaSmoother {
  private smoother: ScalarEmaSmoother;
  private lastRaw: number | null = null;
  private unwrapped: number | null = null;

  constructor(timeConstantMs: number = DEFAULT_SMOOTHING_TIME_CONSTANT_MS) {
    this.smoother = new ScalarEmaSmoother(timeConstantMs);
  }

  update(rawDegrees: number, dtMs: number): number {
    if (this.lastRaw === null || this.unwrapped === null) {
      this.lastRaw = rawDegrees;
      this.unwrapped = rawDegrees;
      return this.smoother.update(rawDegrees, dtMs);
    }
    let delta = rawDegrees - this.lastRaw;
    // Normalize the step into (-180, 180] so a boundary crossing is a small step.
    delta = ((((delta + 180) % 360) + 360) % 360) - 180;
    this.unwrapped += delta;
    this.lastRaw = rawDegrees;
    const smoothed = this.smoother.update(this.unwrapped, dtMs);
    // Wrap the smoothed value back into (-180, 180] for output.
    return ((((smoothed + 180) % 360) + 360) % 360) - 180;
  }

  reset(): void {
    this.smoother.reset();
    this.lastRaw = null;
    this.unwrapped = null;
  }
}

export interface SmoothableTransform {
  anchorXPx: number;
  anchorYPx: number;
  scale: number;
  rotationDegrees: number;
}

/** Smooths a full LiveTransform (position, scale, rotation) as one unit, so callers don't
 * have to wire up four separate smoothers by hand. */
export class TransformSmoother {
  private readonly x: ScalarEmaSmoother;
  private readonly y: ScalarEmaSmoother;
  private readonly scale: ScalarEmaSmoother;
  private readonly rotation: AngleEmaSmoother;

  constructor(timeConstantMs: number = DEFAULT_SMOOTHING_TIME_CONSTANT_MS) {
    this.x = new ScalarEmaSmoother(timeConstantMs);
    this.y = new ScalarEmaSmoother(timeConstantMs);
    this.scale = new ScalarEmaSmoother(timeConstantMs);
    this.rotation = new AngleEmaSmoother(timeConstantMs);
  }

  update(raw: SmoothableTransform, dtMs: number): SmoothableTransform {
    return {
      anchorXPx: this.x.update(raw.anchorXPx, dtMs),
      anchorYPx: this.y.update(raw.anchorYPx, dtMs),
      scale: this.scale.update(raw.scale, dtMs),
      rotationDegrees: this.rotation.update(raw.rotationDegrees, dtMs),
    };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.scale.reset();
    this.rotation.reset();
  }
}
