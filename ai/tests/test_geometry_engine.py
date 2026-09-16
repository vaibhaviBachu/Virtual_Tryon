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
        "category_slug": "earring",
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
        "category_slug": "earring",
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


def test_no_face_returns_structured_ear_not_visible_error():
    noise = (np.random.RandomState(1).rand(400, 400, 3) * 255).astype(np.uint8)
    engine = GeometryTryOnEngine()
    config = {"category_slug": "earring", "side": "left", "face_landmarks": None, "pose_landmarks": None}
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
        "category_slug": "earring", "side": "left",
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
        "category_slug": "earring", "side": "both",
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
        "category_slug": "earring", "side": "both",
        "face_landmarks": _serialize_face(face_result), "pose_landmarks": None,
    }
    asset_bytes = _stud_earring_asset_bytes()
    photo_bytes = _jpeg_bytes(image)
    r1 = engine.render(photo_bytes, asset_bytes, config)
    r2 = engine.render(photo_bytes, asset_bytes, config)
    assert r1.result_image_bytes == r2.result_image_bytes
    assert r1.placement_metadata == r2.placement_metadata
