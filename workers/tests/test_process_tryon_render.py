"""
Full-pipeline worker tests for workers/tasks/process_tryon_render.py — job received ->
row validation (readiness/asset gating) -> real GeometryTryOnEngine render -> result
stored -> DB updated, plus every blocked/failed path (spec §21, §37).
"""
import io
from datetime import timedelta
from typing import BinaryIO, Dict

import numpy as np
import pytest
from PIL import Image

from ai.landmarks.face import FaceLandmarker
from db.models import (
    AssetType,
    Jewellery,
    JewelleryAsset,
    JewelleryCategory,
    ProcessingStatus,
    TryOnRender,
    TryOnRenderStatus,
    TryOnRequest,
    TryOnRequestStatus,
    TryOnSession,
    UserImage,
)
from jobqueue import TryOnRenderJob
from storage.base import ObjectStorage
from workers.db import session_scope
from workers.tasks.process_tryon_render import RenderRowMissingError, _load_rows, process_one_job
from workers.tasks.process_tryon_request import _serialize_face


class InMemoryObjectStorage(ObjectStorage):
    def __init__(self) -> None:
        self._data: Dict[str, bytes] = {}

    def upload(self, key: str, data: BinaryIO, content_type: str = "application/octet-stream") -> None:
        self._data[key] = data.read()

    def download(self, key: str) -> bytes:
        return self._data[key]

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def exists(self, key: str) -> bool:
        return key in self._data

    def create_signed_url(self, key: str, expires_in: timedelta = timedelta(minutes=15)) -> str:
        return f"http://fake-storage.test/{key}"

    def ping(self) -> bool:
        return True


EVAL_FRONT_DIR = __file__.replace(
    "workers/tests/test_process_tryon_render.py", "evaluation/users/front"
)


def _front_face_image() -> np.ndarray:
    import os

    files = [f for f in os.listdir(EVAL_FRONT_DIR) if f.lower().endswith((".jpg", ".png"))]
    return np.asarray(Image.open(os.path.join(EVAL_FRONT_DIR, files[0])).convert("RGB"))


def _jpeg_bytes(image_rgb: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(image_rgb).save(buf, format="JPEG")
    return buf.getvalue()


def _stud_earring_png_bytes(size=80) -> bytes:
    arr = np.zeros((size, size, 4), dtype=np.uint8)
    yy, xx = np.ogrid[:size, :size]
    center = size // 2
    radius = size // 3
    mask = (xx - center) ** 2 + (yy - center) ** 2 <= radius**2
    arr[mask, :3] = [212, 175, 55]
    arr[mask, 3] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def face_landmarker():
    fl = FaceLandmarker()
    yield fl
    fl.close()


@pytest.fixture()
def storage():
    return InMemoryObjectStorage()


@pytest.fixture()
def earring_category():
    """Milestone 4's engine keys off the category SLUG "earring" exactly (this
    milestone's two functional categories are fixed, spec §26) — reuse an existing row
    with that slug if one is already present (matches real catalogue data: one
    canonical "earring" category) rather than creating and deleting a duplicate every
    test run, which would collide on the unique slug constraint."""
    with session_scope() as db:
        existing = db.query(JewelleryCategory).filter(JewelleryCategory.slug == "earring").first()
        if existing:
            yield existing.id
            return
        category = JewelleryCategory(name="Earrings", slug="earring")
        db.add(category)
        db.flush()
        category_id = category.id

    yield category_id

    with session_scope() as db:
        # Only delete if no jewellery rows still reference it (the FK is RESTRICT) —
        # by teardown time this fixture's own dependent test rows are already gone
        # (pytest tears down fixtures in reverse dependency order).
        still_referenced = db.query(Jewellery).filter(Jewellery.category_id == category_id).count() > 0
        if not still_referenced:
            row = db.get(JewelleryCategory, category_id)
            if row:
                db.delete(row)


@pytest.fixture()
def ready_earring_setup(unique_suffix, storage, earring_category, face_landmarker):
    """Real Postgres rows for a full happy-path render: a ready processed earring
    asset, a `ready` TryOnRequest with real detected face landmarks + ears_ready=True
    readiness, and a queued TryOnRender row."""
    asset_key = f"jewellery/test-{unique_suffix}/processed/stud.png"
    storage.upload(asset_key, io.BytesIO(_stud_earring_png_bytes()), content_type="image/png")

    image = _front_face_image()
    photo_key = f"uploads/test-{unique_suffix}/original/photo.jpg"
    storage.upload(photo_key, io.BytesIO(_jpeg_bytes(image)), content_type="image/jpeg")

    face_result = face_landmarker.detect(image)
    assert face_result.success is True

    with session_scope() as db:
        jewellery = Jewellery(
            category_id=earring_category, name="Test Stud", slug=f"test-stud-{unique_suffix}",
            sku=f"SKU-{unique_suffix}",
        )
        db.add(jewellery)
        db.flush()
        asset = JewelleryAsset(
            jewellery_id=jewellery.id, asset_type=AssetType.processed, storage_key=asset_key,
            mime_type="image/png", processing_status=ProcessingStatus.ready, mirrorable=False,
        )
        db.add(asset)

        session = TryOnSession(device_info={})
        db.add(session)
        db.flush()
        user_image = UserImage(session_id=session.id, storage_key=photo_key, mime_type="image/jpeg", capture_source="upload")
        db.add(user_image)
        db.flush()
        request = TryOnRequest(
            session_id=session.id, user_image_id=user_image.id, status=TryOnRequestStatus.ready,
            face_landmarks=_serialize_face(face_result),
            readiness={"ears_ready": True, "neck_ready": False, "reasons": {}},
        )
        db.add(request)
        db.flush()
        render = TryOnRender(request_id=request.id, jewellery_id=jewellery.id, category_slug="earring")
        db.add(render)
        db.flush()

        ids = (render.id, request.id, jewellery.id, asset.id, session.id)

    yield ids

    render_id, request_id, jewellery_id, asset_id, session_id = ids
    with session_scope() as db:
        r = db.get(TryOnRender, render_id)
        if r:
            db.delete(r)
        req = db.get(TryOnRequest, request_id)
        if req:
            db.delete(req)
        s = db.get(TryOnSession, session_id)
        if s:
            db.delete(s)
        j = db.get(Jewellery, jewellery_id)
        if j:
            db.delete(j)


def test_full_render_pipeline_success(storage, ready_earring_setup):
    render_id, request_id, *_ = ready_earring_setup
    job = TryOnRenderJob.create(render_id=str(render_id), request_id=str(request_id))

    timings = process_one_job(job, storage=storage, queue_wait_seconds=0.01)
    assert timings.total_seconds > 0

    with session_scope() as db:
        render = db.get(TryOnRender, render_id)
        assert render.status == TryOnRenderStatus.ready
        assert render.result_storage_key is not None
        assert render.debug_storage_key is not None
        assert render.placement_metadata is not None
        assert render.error_code is None
        assert storage.exists(render.result_storage_key)
        result_bytes = storage.download(render.result_storage_key)
        out = Image.open(io.BytesIO(result_bytes))
        assert out.mode in ("RGB", "RGBA")


def test_render_blocked_when_ears_not_ready(storage, ready_earring_setup):
    render_id, request_id, *_ = ready_earring_setup
    with session_scope() as db:
        request = db.get(TryOnRequest, request_id)
        request.readiness = {"ears_ready": False, "reasons": {"ears": "Ears not visible."}}

    job = TryOnRenderJob.create(render_id=str(render_id), request_id=str(request_id))
    process_one_job(job, storage=storage, queue_wait_seconds=0.0)

    with session_scope() as db:
        render = db.get(TryOnRender, render_id)
        assert render.status == TryOnRenderStatus.blocked
        assert render.error_code == "EAR_NOT_VISIBLE"
        assert render.result_storage_key is None


def test_render_blocked_when_asset_not_ready(storage, ready_earring_setup):
    render_id, request_id, jewellery_id, asset_id, _ = ready_earring_setup
    with session_scope() as db:
        asset = db.get(JewelleryAsset, asset_id)
        asset.processing_status = ProcessingStatus.pending

    job = TryOnRenderJob.create(render_id=str(render_id), request_id=str(request_id))
    process_one_job(job, storage=storage, queue_wait_seconds=0.0)

    with session_scope() as db:
        render = db.get(TryOnRender, render_id)
        assert render.status == TryOnRenderStatus.blocked
        assert render.error_code == "ASSET_NOT_READY"


def test_render_blocked_when_request_not_finished_analysis(storage, ready_earring_setup):
    render_id, request_id, *_ = ready_earring_setup
    with session_scope() as db:
        request = db.get(TryOnRequest, request_id)
        request.status = TryOnRequestStatus.processing

    job = TryOnRenderJob.create(render_id=str(render_id), request_id=str(request_id))
    process_one_job(job, storage=storage, queue_wait_seconds=0.0)

    with session_scope() as db:
        render = db.get(TryOnRender, render_id)
        assert render.status == TryOnRenderStatus.blocked
        assert render.error_code == "REQUEST_NOT_READY"


def test_missing_render_row_is_skipped_not_crashed(storage):
    job = TryOnRenderJob.create(render_id="00000000-0000-0000-0000-000000000000", request_id="x")
    timings = process_one_job(job, storage=storage, queue_wait_seconds=0.0)
    assert timings.total_seconds >= 0


def test_load_rows_raises_for_missing_render():
    with session_scope() as db:
        job = TryOnRenderJob.create(render_id="00000000-0000-0000-0000-000000000000", request_id="x")
        with pytest.raises(RenderRowMissingError):
            _load_rows(db, job)


def test_storage_download_failure_marks_render_failed_not_stuck(ready_earring_setup):
    render_id, request_id, *_ = ready_earring_setup
    job = TryOnRenderJob.create(render_id=str(render_id), request_id=str(request_id))
    broken_storage = InMemoryObjectStorage()  # empty — download() will KeyError

    process_one_job(job, storage=broken_storage, queue_wait_seconds=0.0)

    with session_scope() as db:
        render = db.get(TryOnRender, render_id)
        assert render.status == TryOnRenderStatus.failed
        assert render.error_message is not None
        assert "Traceback" not in render.error_message
