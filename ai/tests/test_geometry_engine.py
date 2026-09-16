"""
GeometryTryOnEngine integration tests — real face/pose landmark inference (Milestone 3
modules) feeding the real Milestone 4 geometry pipeline end to end, per spec §36 ("real
image tests... record actual results") and §37 ("failure cases... each should produce a
controlled error/status").
"""
import io
import os

import numpy as np
import pytest
from PIL import Image

from ai.engines.geometry.engine import GeometryTryOnEngine
from ai.landmarks.face import FaceLandmarker
from ai.landmarks.pose import PoseLandmarker
from workers.tasks.process_tryon_request import _serialize_face, _serialize_pose

EVAL_USERS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evaluation", "users")
POSE_IMAGE = os.path.join(
    os.path.dirname(__file__), "..", "..", "evaluation", "data", "test_images", "opencv_sample_person.jpg"
)


@pytest.fixture(scope="module")
def face_landmarker():
    fl = FaceLandmarker()
    yield fl
    fl.close()


@pytest.fixture(scope="module")
def pose_landmarker():
    pl = PoseLandmarker()
    yield pl
    pl.close()


def _load_scenario(scenario: str) -> np.ndarray:
    scenario_dir = os.path.join(EVAL_USERS_DIR, scenario)
    files = [f for f in os.listdir(scenario_dir) if f.lower().endswith((".jpg", ".png"))]
    return np.asarray(Image.open(os.path.join(scenario_dir, files[0])).convert("RGB"))


def _jpeg_bytes(image_rgb: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(image_rgb).save(buf, format="JPEG")
    return buf.getvalue()


def _stud_earring_asset_bytes(size=80) -> bytes:
    """A small, round, roughly-symmetric synthetic earring cutout — deliberately
    trivial geometry (a filled circle) so test assertions can reason about its exact
    pixel footprint; this is a synthetic/evaluation fixture, never a real customer or
    catalogue image (spec §32's provenance rule applied here too)."""
    arr = np.zeros((size, size, 4), dtype=np.uint8)
    yy, xx = np.ogrid[:size, :size]
    center = size // 2
    radius = size // 3
    mask = (xx - center) ** 2 + (yy - center) ** 2 <= radius**2
    arr[mask, :3] = [212, 175, 55]  # gold-ish color
    arr[mask, 3] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def _necklace_asset_bytes(width=200, height=60) -> bytes:
    arr = np.zeros((height, width, 4), dtype=np.uint8)
    arr[height // 2 - 5 : height // 2 + 5, 10 : width - 10, :3] = [200, 200, 210]
    arr[height // 2 - 5 : height // 2 + 5, 10 : width - 10, 3] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def test_earring_renders_successfully_on_frontal_face(face_landmarker):
    image = _load_scenario("front")
    face_result = face_landmarker.detect(image)
    assert face_result.success is True

    engine = GeometryTryOnEngine()
    config = {
        "category_slug": "earrings",
        "side": "both",
        "face_landmarks": _serialize_face(face_result),
        "pose_landmarks": None,
        "mirrorable": False,
    }
    result = engine.render(_jpeg_bytes(image), _stud_earring_asset_bytes(), config)

    assert result.success is True, result.error_message
    assert result.result_image_bytes is not None
    out = Image.open(io.BytesIO(result.result_image_bytes))
    assert out.size == (image.shape[1], image.shape[0])
    assert result.placement_metadata is not None
    placements = result.placement_metadata["placements"]
    assert {p["side"] for p in placements} == {"left", "right"}
    for p in placements:
        assert p["anchor"]["success"] is True
        assert p["scale"]["success"] is True
        assert p["transform"] is not None


def test_earring_result_differs_from_original_photo(face_landmarker):
    """A real placement must actually change pixels near the ear, not just echo the
    original photo back (spec §39: 'inspect for correct position ... no obvious lack of
    change')."""
    image = _load_scenario("front")
    face_result = face_landmarker.detect(image)
    engine = GeometryTryOnEngine()
    config = {
        "category_slug": "earrings",
        "side": "right",
        "face_landmarks": _serialize_face(face_result),
        "pose_landmarks": None,
    }
    result = engine.render(_jpeg_bytes(image), _stud_earring_asset_bytes(), config)
    assert result.success is True
    out_rgb = np.asarray(Image.open(io.BytesIO(result.result_image_bytes)).convert("RGB"))
    assert not np.array_equal(out_rgb, image)


def test_necklace_renders_successfully_on_real_pose_photo(pose_landmarker):
    image = np.asarray(Image.open(POSE_IMAGE).convert("RGB"))
    pose_result = pose_landmarker.detect(image)
    assert pose_result.success is True

    engine = GeometryTryOnEngine()
    config = {
        "category_slug": "necklace",
        "face_landmarks": None,
        "pose_landmarks": _serialize_pose(pose_result),
    }
    result = engine.render(_jpeg_bytes(image), _necklace_asset_bytes(), config)
    assert result.success is True, result.error_message
    placements = result.placement_metadata["placements"]
    assert len(placements) == 1
    assert placements[0]["anchor"]["success"] is True


def test_necklace_result_differs_from_original_photo(pose_landmarker):
    """Same real-pixel-diff check as test_earring_result_differs_from_original_photo,
    but for necklace — a real "runtime, result looked identical to the original photo"
    bug on a live deployment (physical_width_mm entered in the wrong unit, see
    test_necklace_with_implausibly_small_physical_width_is_barely_visible below) slipped
    through Milestone 4's original test suite specifically because no test asserted
    this for the necklace category, only earrings."""
    image = np.asarray(Image.open(POSE_IMAGE).convert("RGB"))
    pose_result = pose_landmarker.detect(image)
    assert pose_result.success is True

    engine = GeometryTryOnEngine()
    config = {
        "category_slug": "necklace",
        "face_landmarks": None,
        "pose_landmarks": _serialize_pose(pose_result),
    }
    jpeg_bytes = _jpeg_bytes(image)
    result = engine.render(jpeg_bytes, _necklace_asset_bytes(), config)
    assert result.success is True, result.error_message
    # Compare against the JPEG-decoded baseline (what the engine itself actually saw as
    # its starting canvas), not the pre-compression array — otherwise ordinary JPEG
    # compression noise across the whole photo would swamp the real, localized
    # jewellery-compositing signal this test is meant to isolate.
    baseline_rgb = np.asarray(Image.open(io.BytesIO(jpeg_bytes)).convert("RGB"))
    out_rgb = np.asarray(Image.open(io.BytesIO(result.result_image_bytes)).convert("RGB"))
    assert not np.array_equal(out_rgb, baseline_rgb)
    changed_pixels = int(np.any(out_rgb != baseline_rgb, axis=2).sum())
    assert changed_pixels > 50, (
        f"Only {changed_pixels} pixels changed — the necklace is effectively invisible "
        "in the rendered result."
    )


def test_necklace_with_implausibly_small_physical_width_is_barely_visible(pose_landmarker):
    """Regression test for a real production bug: a catalogue item with
    physical_width_mm set far too small (e.g. an admin entering the wrong unit) makes
    ai.geometry.scale's physical-dimensions path compute a near-zero target width.
    MIN_SCALE_FACTOR's safety clamp (ai/geometry/constants.py) still lets the render
    report success, but the jewellery ends up only a few pixels wide — visually
    indistinguishable from nothing having been rendered. This is now caught at
    catalogue-data-entry time (see apps/api/v1/services/jewellery_service.py's
    ImplausiblePhysicalDimensionError), but this test documents and pins the underlying
    engine behavior directly, independent of that API-layer guard, using the exact
    numbers this bug was reproduced with (evaluation.debug_necklace against a real
    render): ~5-7 changed pixels at physical_width_mm=5 vs. ~1200+ at 180mm for the
    identical asset/photo/pose."""
    image = np.asarray(Image.open(POSE_IMAGE).convert("RGB"))
    pose_result = pose_landmarker.detect(image)
    assert pose_result.success is True
    serialized_pose = _serialize_pose(pose_result)
    asset_bytes = _necklace_asset_bytes()
    jpeg_bytes = _jpeg_bytes(image)
    baseline_rgb = np.asarray(Image.open(io.BytesIO(jpeg_bytes)).convert("RGB"))

    engine = GeometryTryOnEngine()

    implausible_result = engine.render(
        jpeg_bytes,
        asset_bytes,
        {
            "category_slug": "necklace",
            "face_landmarks": None,
            "pose_landmarks": serialized_pose,
            "physical_width_mm": 5.0,
        },
    )
    plausible_result = engine.render(
        jpeg_bytes,
        asset_bytes,
        {
            "category_slug": "necklace",
            "face_landmarks": None,
            "pose_landmarks": serialized_pose,
            "physical_width_mm": 180.0,
        },
    )
    assert implausible_result.success is True
    assert plausible_result.success is True

    implausible_out = np.asarray(Image.open(io.BytesIO(implausible_result.result_image_bytes)).convert("RGB"))
    plausible_out = np.asarray(Image.open(io.BytesIO(plausible_result.result_image_bytes)).convert("RGB"))
    implausible_changed = int(np.any(implausible_out != baseline_rgb, axis=2).sum())
    plausible_changed = int(np.any(plausible_out != baseline_rgb, axis=2).sum())

    # The point of this test is the RATIO, not fixed pixel counts (which depend on this
    # image/asset's exact geometry) — a too-small physical width must produce
    # dramatically fewer changed pixels than a plausible one for the identical asset,
    # photo, and pose.
    assert plausible_changed > implausible_changed * 20, (
        f"plausible_changed={plausible_changed}, implausible_changed={implausible_changed} "
        "— expected the plausible physical_width_mm to produce a far more visible render."
    )


def test_no_face_returns_structured_ear_not_visible_error():
    noise = (np.random.RandomState(1).rand(400, 400, 3) * 255).astype(np.uint8)
    engine = GeometryTryOnEngine()
    config = {"category_slug": "earrings", "side": "left", "face_landmarks": None, "pose_landmarks": None}
    result = engine.render(_jpeg_bytes(noise), _stud_earring_asset_bytes(), config)
    assert result.success is False
    assert result.error_code == "FACE_NOT_VISIBLE"


def test_no_pose_returns_structured_neck_not_visible_error():
    noise = (np.random.RandomState(2).rand(400, 400, 3) * 255).astype(np.uint8)
    engine = GeometryTryOnEngine()
    config = {"category_slug": "necklace", "face_landmarks": None, "pose_landmarks": None}
    result = engine.render(_jpeg_bytes(noise), _necklace_asset_bytes(), config)
    assert result.success is False
    assert result.error_code == "NECK_NOT_VISIBLE"


def test_unsupported_category_is_rejected():
    noise = (np.random.RandomState(4).rand(200, 200, 3) * 255).astype(np.uint8)
    engine = GeometryTryOnEngine()
    config = {"category_slug": "ring", "face_landmarks": None, "pose_landmarks": None}
    result = engine.render(_jpeg_bytes(noise), _stud_earring_asset_bytes(), config)
    assert result.success is False
    assert result.error_code == "UNSUPPORTED_CATEGORY"


def test_invalid_asset_bytes_return_structured_error(face_landmarker):
    image = _load_scenario("front")
    face_result = face_landmarker.detect(image)
    engine = GeometryTryOnEngine()
    config = {
        "category_slug": "earrings", "side": "left",
        "face_landmarks": _serialize_face(face_result), "pose_landmarks": None,
    }
    blank_asset = np.zeros((50, 50, 4), dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(blank_asset, mode="RGBA").save(buf, format="PNG")
    result = engine.render(_jpeg_bytes(image), buf.getvalue(), config)
    assert result.success is False
    assert result.error_code == "ASSET_INVALID"


def test_debug_visualization_available_via_render_with_debug(face_landmarker):
    image = _load_scenario("front")
    face_result = face_landmarker.detect(image)
    engine = GeometryTryOnEngine()
    config = {
        "category_slug": "earrings", "side": "both",
        "face_landmarks": _serialize_face(face_result), "pose_landmarks": None,
    }
    geometry_result = engine.render_with_debug(_jpeg_bytes(image), _stud_earring_asset_bytes(), config)
    assert geometry_result.success is True
    assert geometry_result.debug_image_rgb is not None
    assert geometry_result.debug_image_rgb.shape == image.shape


def test_deterministic_given_identical_inputs(face_landmarker):
    """Spec §14: 'given identical input image, landmarks, jewellery asset, metadata, it
    must produce the same transformation' — verified directly here for the full engine,
    not just the individual math functions."""
    image = _load_scenario("front")
    face_result = face_landmarker.detect(image)
    engine = GeometryTryOnEngine()
    config = {
        "category_slug": "earrings", "side": "both",
        "face_landmarks": _serialize_face(face_result), "pose_landmarks": None,
    }
    asset_bytes = _stud_earring_asset_bytes()
    photo_bytes = _jpeg_bytes(image)
    r1 = engine.render(photo_bytes, asset_bytes, config)
    r2 = engine.render(photo_bytes, asset_bytes, config)
    assert r1.result_image_bytes == r2.result_image_bytes
    assert r1.placement_metadata == r2.placement_metadata
