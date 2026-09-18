/**
 * Live AR geometry constants — a direct TypeScript port of
 * `ai/geometry/constants.py`'s values (Milestone 4), so the browser-side Live AR
 * renderer and the Python photo-try-on engine compute the SAME anchor/scale/rotation
 * for the same landmarks, per Milestone 5 spec §3 ("reuse existing geometry concepts").
 *
 * This file intentionally duplicates the Python constants rather than importing them
 * (there is no shared-language config layer in this repo), so every value below MUST be
 * kept numerically identical to its ai/geometry/constants.py counterpart — each is
 * annotated with which Python constant it mirrors. `live-ar-parity.test.ts` guards this
 * by asserting the two geometry engines agree on real landmark fixtures.
 *
 * See ai/geometry/constants.py for the full rationale/derivation of every value; it is
 * not repeated here to avoid two documents drifting out of sync.
 */

// Mirrors AVERAGE_ADULT_FACE_WIDTH_MM
export const AVERAGE_ADULT_FACE_WIDTH_MM = 140.0;
// Mirrors AVERAGE_ADULT_SHOULDER_WIDTH_MM
export const AVERAGE_ADULT_SHOULDER_WIDTH_MM = 380.0;

// Mirrors EAR_ANCHOR_VERTICAL_OFFSET_FRACTION
export const EAR_ANCHOR_VERTICAL_OFFSET_FRACTION = 0.16;
// Mirrors NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION. Recalibrated from 0.22 -> 0.08 after
// real-device Live AR verification (2026-09-18): the shoulder-landmark midpoint sits
// almost at the base of the neck already, so 0.22 (roughly a fifth of shoulder width)
// pushed the necklace's top anchor well down onto the chest instead of at the
// neck/collarbone. 0.08 keeps the small documented nudge toward the collarbone without
// dropping the piece past the neck. See ai/geometry/constants.py for the mirrored value.
export const NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION = 0.08;

// Mirrors EARRING_RELATIVE_SCALE_OF_FACE_WIDTH / NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH
export const EARRING_RELATIVE_SCALE_OF_FACE_WIDTH = 0.22;
export const NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH = 0.5;

// Mirrors MIN_SCALE_FACTOR / MAX_SCALE_FACTOR
export const MIN_SCALE_FACTOR = 0.03;
export const MAX_SCALE_FACTOR = 8.0;

// Mirrors MAX_EARRING_ROTATION_DEGREES / MAX_NECKLACE_ROTATION_DEGREES
export const MAX_EARRING_ROTATION_DEGREES = 20.0;
export const MAX_NECKLACE_ROTATION_DEGREES = 25.0;

// Mirrors NECKLACE_LENGTH_OFFSET_MULTIPLIER. Same forward-compatible-only status as the
// Python table: nothing in the Live AR pipeline passes a non-"medium" length yet.
export const NECKLACE_LENGTH_OFFSET_MULTIPLIER: Record<string, number> = {
  medium: 1.0,
  short: 0.7, // UNCALIBRATED placeholder — see ai/geometry/constants.py
  long: 1.3, // UNCALIBRATED placeholder — see ai/geometry/constants.py
};

// --- Live-AR-only constants (no Python equivalent — these govern the continuous
// tracking loop itself, not any single frame's geometry) ---

// How far down the (mouth-corner -> shoulder-midpoint) line the necklace anchor sits,
// as a fraction of that line's own length: 0 = right at the mouth/chin, 1 = right at
// the shoulder line. 0.85 places it close to the shoulders (the base of the neck /
// collarbone, where a necklace naturally rests) while still tracking each frame's own
// visible neck length rather than a fixed proportion of shoulder width. Tune this
// directly against a live camera if the necklace still sits too high/low -- it has no
// Python-pipeline equivalent to keep in sync (geometry.ts's computeNeckBaseAnchorPx
// docstring explains why this is a deliberate Live-AR-only divergence).
export const NECKLACE_NECK_ANCHOR_FRACTION = 0.85;

// Readiness thresholds mirrored from ai/landmarks/readiness.py so live category
// readiness (NECKLACE_READY/EARRINGS_READY) uses the identical bar the photo flow does.
export const FACE_CONFIDENCE_THRESHOLD = 0.5;
export const EAR_CONFIDENCE_THRESHOLD = 0.5;
export const NECK_CONFIDENCE_THRESHOLD = 0.45;

// Tracking-loss grace period (spec §11): how long a category may coast on its last
// good transform after tracking degrades, before jewellery fades out. Chosen to
// absorb a brief blink/occlusion/fast-motion frame or two without a visible flicker,
// while still being short enough that genuinely losing the subject hides jewellery
// promptly rather than leaving it floating on an empty frame.
export const TRACKING_DEGRADED_GRACE_MS = 600;
export const TRACKING_LOST_FADE_MS = 250;

// Smoothing (spec §10): exponential moving average factor per tracked scalar, applied
// per rendered frame (not per tracking-inference frame) via
// `smoothingAlphaForFrameInterval` below so the same visual responsiveness holds
// whether tracking runs at 30fps or is throttled lower (spec §24).
// alpha = 1 keeps 100% of the new sample (no smoothing); smaller = smoother/laggier.
export const DEFAULT_SMOOTHING_TIME_CONSTANT_MS = 120;
