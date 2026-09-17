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
