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

// --- Live-AR-only necklace neck-reference constants (no Python equivalent -- see
// neck-reference.ts's file docstring for the full derivation). These replace a fixed
// pixel/shoulder-width-only offset with an interpolation along a REAL, per-frame
// measured chin-to-shoulder span, so they are proportions of a MEASUREMENT, not
// standalone invented offsets. ---

// How far down the (chin-proxy -> shoulder-midpoint) span the necklace's attachment
// point sits: 0 = right at the chin, 1 = right at the shoulder line.
// History (2026-09-18), each step verified against a real camera, not guessed:
//   0.85 -> too low once the asset-level anchor bug was fixed (see the commit removing
//          this asset's bad anchor_x/anchor_y database override) -- landed at the
//          collarbone/chest line.
//   0.65 -> still too low.
//   0.10 -> confirmed correct against a real camera using the in-app calibration
//           slider (LiveArStudio's necklace debug panel -- see
//           neck-fraction-override.ts), which changes the actual rendered position
//           live so this value is measured empirically, not eyeballed from a fixed
//           rebuild-per-attempt loop. MediaPipe has no "neck base"/collarbone landmark
//           to derive this from directly (there is no published anthropometric ratio
//           for this specific chin-proxy-to-shoulder pairing either -- it's an artifact
//           of this pipeline's own proxy landmarks, not a standardized measurement), so
//           some proportion is unavoidable; this is the one confirmed to land correctly
//           for a real person on a real camera. Re-verify with the slider (not another
//           blind edit here) if a different necklace design or camera setup looks off.
export const NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH = 0.1;

// Diagnostic-only estimate of visible neck width, as a fraction of the measured face
// bounding-box width. Anthropometric surveys put adult neck width at roughly 75-85% of
// bizygomatic face width; 0.8 is the documented midpoint. NOT currently used to drive
// necklace scale (computeScale still calibrates off measured shoulder width -- see its
// own docstring for why that remains the primary, already-adaptive reference).
export const NECK_WIDTH_FRACTION_OF_FACE_WIDTH = 0.8;

// --- Live-AR-only constants (no Python equivalent — these govern the continuous
// tracking loop itself, not any single frame's geometry) ---

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

// Multi-item necklace layering (e.g. wearing a necklace and a haaram at once): each
// additional selected neck item is nudged this many shoulder-widths further down than
// the previous one, so simultaneously worn items land at visibly different depths
// instead of rendering on top of each other. UNCALIBRATED placeholder, same status as
// NECKLACE_LENGTH_OFFSET_MULTIPLIER above -- tune against a real camera if it looks off.
export const NECKLACE_LAYER_SPACING_FRACTION_OF_SHOULDER_WIDTH = 0.16;

// M6.3 (docs/live-ar-realism-architecture.md §6/§8/§17): how often the multiclass
// ImageSegmenter runs a new inference, in milliseconds -- NOT every rendered frame.
// Google's own published benchmark for this exact model (selfie_multiclass_256x256) is
// 217.76ms CPU / 71.24ms GPU per inference on a Pixel 6 (see Sources in the architecture
// doc) -- even the GPU figure alone exceeds one full 24-30fps frame budget (33-42ms), so
// running it every frame would stall the whole render loop. 500ms (2 inferences/sec) is
// a deliberately conservative STARTING point chosen to be safely slower than any
// plausible per-inference cost on this app's own hardware, not a value derived from
// this app's own measurement -- it is UNCALIBRATED pending the real-device numbers
// docs/live-ar-realism-verification.md's M6.3 section records; tune it once those are
// in, the same way NECKLACE_LENGTH_OFFSET_MULTIPLIER above is flagged for future
// calibration. Jewellery tracking/geometry/render continue at the full RAF rate
// regardless -- only segmentation itself is throttled (see segmentation.ts's
// SegmentationCadenceScheduler).
export const SEGMENTATION_INTERVAL_MS_DEFAULT = 500;
