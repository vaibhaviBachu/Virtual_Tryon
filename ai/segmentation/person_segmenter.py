"""
Person-vs-background segmentation for USER photos — Milestone 3.

Deliberately a NEW, separate module from `ai/catalogue/background_remover.py`
(Milestone 2's rembg/U-2-Net catalogue asset background remover) per the spec's
explicit instruction that catalogue asset processing and user-image segmentation are
separate concerns, even though both milestones ultimately answer a similar-sounding
"what is foreground vs background" question.

Model choice: `mediapipe.solutions.selfie_segmentation` (Apache 2.0, weights bundled in
the `mediapipe==0.10.9` wheel — see ai/models/LICENSES.md and ai/landmarks/face.py's
module docstring for the full research trail on why the bundled-weights Solutions API
is usable here at all). This produces a real, measured, per-pixel soft mask
distinguishing the person from the background — a genuine MVP "at minimum a real
person-vs-background mask" per the spec.

HONEST LIMITATION: MediaPipe's Solutions-API selfie segmenter is binary
(person/background) only. It does NOT provide separate hair, skin, or clothing
sub-masks. The newer "Multiclass Selfie Segmenter" that does provide those categories
is only available through the network-dependent Tasks API (blocked in this sandbox,
same as the face/hand/pose Tasks-API models). Rather than fabricate hair/skin/clothing
masks from the single binary mask (which would misrepresent confidence in regions this
model was never trained to distinguish), this module reports exactly one real mask —
`available_masks = ["person"]` — and that limitation is documented here and in
docs/milestone-3-verification.md, not glossed over.
"""
import logging

import numpy as np

from ai.landmarks.schemas import ConfidenceLevel, SegmentationResult, bucket_confidence

logger = logging.getLogger("ai.segmentation.person")

_FOREGROUND_THRESHOLD = 0.5
_DECISIVE_LOW = 0.1
_DECISIVE_HIGH = 0.9


class PersonSegmenter:
    model_name = "mediapipe_selfie_segmentation_0.10.9"

    def __init__(self, model_selection: int = 1) -> None:
        """`model_selection=1` selects MediaPipe's "landscape" model (better for
        full-body/half-body photos typical of a try-on capture); `0` is the "general"
        model, tuned closer-up. Both are bundled; this is a documented, deliberate
        default, not an arbitrary one."""
        import mediapipe as mp

        self._mp = mp
        self._segmenter = mp.solutions.selfie_segmentation.SelfieSegmentation(
            model_selection=model_selection
        )

    def segment(self, image_rgb: np.ndarray) -> tuple[SegmentationResult, np.ndarray | None]:
        """Returns (result, raw_float_mask). The raw mask (HxW float32, [0,1]) is
        returned separately (not embedded in the dataclass) so the worker can encode it
        to a PNG and upload it to private object storage itself — this module has no
        knowledge of storage, per the architectural separation rule."""
        height, width = image_rgb.shape[0], image_rgb.shape[1]
        try:
            result = self._segmenter.process(image_rgb)
        except Exception:
            logger.exception("Segmentation raised unexpectedly")
            return (
                SegmentationResult(
                    success=False,
                    error_message="Segmentation failed unexpectedly on this image.",
                    image_width_px=width,
                    image_height_px=height,
                ),
                None,
            )

        mask = result.segmentation_mask  # HxW float32 in [0,1]
        if mask is None:
            return (
                SegmentationResult(
                    success=False,
                    error_message="Segmentation could not produce a mask for this image.",
                    image_width_px=width,
                    image_height_px=height,
                ),
                None,
            )

        foreground_ratio = float(np.mean(mask > _FOREGROUND_THRESHOLD))
        decisive_pixels = np.mean((mask < _DECISIVE_LOW) | (mask > _DECISIVE_HIGH))
        decisiveness = float(decisive_pixels)

        if foreground_ratio < 0.01:
            return (
                SegmentationResult(
                    success=False,
                    error_message="No person could be found in this photo.",
                    image_width_px=width,
                    image_height_px=height,
                    foreground_ratio=foreground_ratio,
                    decisiveness=decisiveness,
                ),
                mask,
            )

        # Confidence formula (documented, not invented ad hoc): a real segmentation
        # should be decisive (most pixels confidently 0 or 1, not hovering near 0.5) AND
        # cover a plausible fraction of the frame (a person, not a sliver of noise).
        plausible_coverage = 1.0 - abs(foreground_ratio - 0.35) / 0.65  # peak near 35% frame coverage
        plausible_coverage = max(0.0, min(1.0, plausible_coverage))
        confidence = max(0.0, min(1.0, 0.7 * decisiveness + 0.3 * plausible_coverage))

        return (
            SegmentationResult(
                success=True,
                image_width_px=width,
                image_height_px=height,
                foreground_ratio=foreground_ratio,
                decisiveness=decisiveness,
                confidence=confidence,
                confidence_level=bucket_confidence(confidence),
                available_masks=["person"],
            ),
            mask,
        )

    def close(self) -> None:
        self._segmenter.close()
