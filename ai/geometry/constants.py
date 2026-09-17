"""
Every tunable geometry constant lives here, in one place, so it can be reviewed/tuned
without hunting through compute_anchor/compute_scale/compute_rotation (mirrors
ai/landmarks/readiness.py's "thresholds centralized, not sprinkled" rule, and directly
answers spec §40: "avoid magic numbers... every offset must be documented, configurable,
tested").

PHYSICAL SCALE LIMITATION (spec §9, §31 — read before changing any *_MM constant):
A single RGB photo has no depth channel and no metric reference object, so there is no
way to recover true real-world scale (mm-per-pixel) from it alone. The two "AVERAGE_*_MM"
constants below are a DOCUMENTED, CONFIGURABLE, ANTHROPOMETRIC ASSUMPTION used only to
convert a catalogue item's real physical_width_mm into an approximate pixel size — they
are population averages (adult bizygomatic face width, adult biacromial shoulder width),
not a measurement of the specific person in the photo. This is not claimed to be
millimeter-accurate (spec §31/§45): it is a documented, reasonable baseline, and every
TryOnRender's placement_metadata records `used_physical_dimensions` and the exact
assumption text so this limitation is visible in the data, not hidden.
"""

# --- Anthropometric calibration constants (spec §9, §14, §31) ---
# Average adult bizygomatic (cheekbone-to-cheekbone) face width. Source: widely cited
# anthropometric survey ranges (~130-150mm for adults); 140mm is the documented midpoint
# used here as a single, reproducible constant rather than a per-user estimate this
# codebase cannot make from one 2D photo.
AVERAGE_ADULT_FACE_WIDTH_MM = 140.0

# Average adult biacromial (shoulder-to-shoulder) width. Source: same class of
# anthropometric survey data (~360-420mm across adult populations depending on sex);
# 380mm is the documented midpoint used as this milestone's single calibration constant.
AVERAGE_ADULT_SHOULDER_WIDTH_MM = 380.0

# --- Ear anchor vertical offset (spec §7, §8, §40) ---
# ai/landmarks/face.py's own docstring documents that face-mesh landmarks 234/454 sit at
# the CHEEK/EAR BOUNDARY, not the earlobe — the earlobe (where an earring actually hangs
# from) is measurably lower on the face. This fraction (of the face bounding box's own
# height) nudges the ear anchor down toward the earlobe. It is a documented geometric
# correction for a named, specific limitation of the upstream landmark set (not a
# tuned-until-it-looks-right offset) and is covered by
# ai/tests/test_geometry_anchors.py::test_ear_anchor_applies_documented_vertical_offset.
EAR_ANCHOR_VERTICAL_OFFSET_FRACTION = 0.16

# --- Necklace anchor vertical offset (spec §12, §13, §40) ---
# ai/landmarks/pose.py's neck_anchor is the MIDPOINT OF THE TWO SHOULDER LANDMARKS, which
# sits at shoulder height, not at the neck/collarbone where a necklace's highest point
# actually rests. This fraction (of the shoulder-width measurement) nudges the anchor
# down toward the collarbone/upper-chest region. Documented correction for a named
# geometric mismatch between "shoulder midpoint" and "necklace resting point", not a
# cosmetic tweak — see test_geometry_anchors.py::test_necklace_anchor_applies_documented_vertical_offset.
NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION = 0.22

# --- Relative (physical-scale-unavailable) fallback scaling (spec §9, §14, §31) ---
# When the catalogue item has no physical_width_mm, scale is derived as a fraction of a
# real, measured facial/body reference distance instead of an arbitrary pixel constant.
# These fractions were chosen so a typical earring/necklace asset (after the Milestone 2
# alpha-bbox crop) renders at a plausible on-face/on-body size across the evaluation
# dataset's frontal test images (see docs/milestone-4-verification.md's "Scale
# assumptions" section for the worked derivation) — they are a documented, adjustable
# baseline, not claimed to be correct for every jewellery design.
EARRING_RELATIVE_SCALE_OF_FACE_WIDTH = 0.22
NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH = 0.5

# --- Safety clamps (spec §40: never let a noisy landmark produce a nonsensical render) ---
MIN_SCALE_FACTOR = 0.03
MAX_SCALE_FACTOR = 8.0

# --- Rotation caps (spec §10, §15, §40) ---
# ai/landmarks/face.py's yaw estimate and the cheek-edge-landmark line used for in-plane
# roll are both heuristics, not a calibrated 3D head-pose solve (documented in that
# module). Capping the resulting in-plane rotation correction prevents a noisy/extreme
# landmark reading (e.g. from partial occlusion) from spinning the jewellery asset to an
# implausible angle — this is an explicit, tested safety bound, not an invented "looks
# right" number.
MAX_EARRING_ROTATION_DEGREES = 20.0
MAX_NECKLACE_ROTATION_DEGREES = 25.0

# --- Minimum in-frame visibility (spec §21, §40) ---
# Found on a real deployment (not hypothetical): a photo where the subject's shoulders
# are confidently detected (readiness's neck_ready check only verifies
# ai.landmarks.pose's shoulder_confidence — it says nothing about WHERE in the frame
# the shoulders sit) but framed close to the bottom edge of the photo (common in
# webcam/laptop-camera captures) can push the necklace anchor, after
# NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION's documented collarbone offset, entirely
# past the photo's bottom edge. cv2.warpAffine still "succeeds" in that case — it just
# produces a fully-transparent result outside its output canvas — so the render
# reports success while being pixel-identical (or nearly so) to the original photo.
# ai.geometry.transform.bbox_overlap_fraction measures how much of the transformed
# jewellery's own bounding box actually lands within the photo; below this fraction,
# ai.engines.geometry.engine treats the placement as a real, structured failure
# (JEWELLERY_OUT_OF_FRAME) instead of a silent no-op "success". 0.3 (30%) was chosen
# so a jewellery item merely clipped at one edge (still recognizably visible) still
# succeeds, while one pushed almost entirely off-canvas — as in the reproduced bug,
# which had 0% overlap — fails honestly instead.
MIN_JEWELLERY_VISIBLE_OVERLAP_FRACTION = 0.3

# --- Pre-selection necklace framing pre-check (Milestone 4 stabilization: "FIX
# NECKLACE FRAMING / PLACEMENT ROBUSTNESS" spec §3, §4, §5, §11) ---
# ai.geometry.framing.evaluate_necklace_framing runs BEFORE the user has picked a
# specific jewellery item, so — unlike MIN_JEWELLERY_VISIBLE_OVERLAP_FRACTION above,
# which checks the ACTUAL selected asset's alpha bounding box — it has no real asset
# geometry to measure against yet. It can only reason about the photo itself: how much
# vertical space is available below the computed necklace BODY_ANCHOR before the photo
# runs out.
#
# This constant expresses that minimum required space as a fraction of the SAME real,
# per-photo measured shoulder-width (AnchorResult.reference_measurement_px) the
# render-time engine will later use for scale — never a fixed pixel constant, so it
# adapts to image resolution and subject distance automatically (spec §14, §15).
#
# Derivation (spec §5: "do not invent arbitrary values"): NECKLACE_RELATIVE_SCALE_OF_
# SHOULDER_WIDTH above already fixes a typical necklace's default rendered WIDTH at
# ~0.5x shoulder width when no catalogue physical_width_mm drives scale instead. A
# typical short/medium necklace's visible vertical drop below the collarbone is smaller
# than its own width (most catalogue necklaces are wider than they are tall in their
# alpha bounding box), so 0.35 (70% of the 0.5 width fraction) is used as a deliberately
# CONSERVATIVE, documented proxy for "enough room for a typical necklace to fit
# vertically" — not a precise geometric guarantee for any specific asset.
#
# This is intentionally a HEURISTIC, advisory pre-check only (spec §11: "do not
# overreject" — err toward ALLOW). The authoritative, per-asset decision remains
# ai.engines.geometry.engine's MIN_JEWELLERY_VISIBLE_OVERLAP_FRACTION check against the
# real selected asset's real alpha bounding box at render time; that check is
# unchanged by this constant and always has the final say (spec: "DO NOT simply remove
# the safety check").
#
# Calibrated against the real production bug this milestone's whole investigation
# started from (see JEWELLERY_OUT_OF_FRAME's history above): that photo measured
# shoulder_width_px=381.42 and had only ~-46px of space below the anchor (the anchor
# itself was past the bottom edge) — required_vertical_space_px = 0.35 * 381.42 =
# ~133.5px there, so this threshold correctly flags that exact real photo as
# insufficient while remaining loose enough not to reject photos with a comfortable
# amount of visible upper chest.
NECKLACE_MIN_REQUIRED_VERTICAL_SPACE_FRACTION = 0.35

# --- Necklace-length-aware anchor offset (Milestone 4 stabilization: "NECKLACE
# GEOMETRY CALIBRATION" spec §4) ---
# Different necklace lengths (a short choker vs. a long haaram) should sit at
# different vertical offsets from the shoulder line — a choker rests near the
# collarbone, a long necklace hangs further down the chest. This table is
# FORWARD-COMPATIBLE ARCHITECTURE ONLY: there is currently no catalogue field
# capturing a necklace's length category, and this spec explicitly says not to
# implement HAARAM yet, so every key below except "medium" is an UNCALIBRATED
# placeholder ratio (not yet validated against any real photo) and nothing in this
# codebase passes a non-None necklace_length yet — ai.geometry.anchors.compute_anchor
# defaults to None, which maps to 1.0 (today's unchanged, already-shipped behavior).
# Do not treat "short"/"long" as production-ready until they have been checked
# against a real calibration dataset (spec §9) the way NECKLACE_ANCHOR_VERTICAL_
# OFFSET_FRACTION itself was checked against this milestone's real production bug.
NECKLACE_LENGTH_OFFSET_MULTIPLIER = {
    None: 1.0,  # unknown/unspecified length -> today's existing, shipped behavior
    "medium": 1.0,
    "short": 0.7,  # UNCALIBRATED placeholder — a choker should sit higher, not yet proven
    "long": 1.3,  # UNCALIBRATED placeholder — hangs lower, not yet proven
    # "haaram" deliberately omitted: spec explicitly says do not implement it yet.
}
