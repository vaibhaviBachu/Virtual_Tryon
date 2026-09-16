"""
Tests for workers/tasks/process_jewellery_asset.py — the job consumer that turns a
`processed` placeholder JewelleryAsset row into a real processed+thumbnail pair.

Runs against the real Postgres database (workers.db.session_scope) since this module's
entire job is database + storage side effects — a mocked-out DB would test nothing real.
Object storage is a fake in-memory ObjectStorage (not boto3/moto) so these tests don't
need network or a running moto server, and the background-removal processor is a
scripted stub for the failure-path tests (forcing a specific failure deterministically)
and the real CatalogueAssetProcessor + real rembg model for the success-path test.
"""
from datetime import timedelta
from typing import BinaryIO, Dict

import pytest

from ai.catalogue.background_remover import get_remover
from ai.catalogue.processor import CatalogueAssetProcessor, ProcessingFailedError
from db.models import AssetType, Jewellery, JewelleryAsset, JewelleryCategory, ProcessingStatus
from jobqueue import CatalogueAssetProcessingJob
from storage.base import ObjectStorage
from workers.db import session_scope
from workers.tasks.process_jewellery_asset import AssetRowMissingError, _load_rows, process_one_job


class InMemoryObjectStorage(ObjectStorage):
    """A trivial real implementation of the ObjectStorage interface — not a Mock, an
    actual working (if non-persistent) store — so process_one_job's calls to
    .download()/.upload() exercise real interface behavior."""

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


class _AlwaysFailsProcessor:
    def process(self, original_image_bytes: bytes):
        raise ProcessingFailedError("synthetic processing failure for testing")


@pytest.fixture()
def seeded_asset_pair(unique_suffix):
    """Creates a real jewellery item + original asset (with real bytes in the fake
    storage) + pending processed placeholder row, mirroring exactly what
    apps/api/v1/services/asset_service.upload_original_asset creates. Yields
    (job, storage) and cleans up afterward."""
    from PIL import Image, ImageDraw
    import io

    img = Image.new("RGB", (400, 400), (255, 255, 255))
    ImageDraw.Draw(img).ellipse((100, 100, 300, 300), outline=(200, 160, 40), width=30)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=95)
    original_bytes = buffer.getvalue()

    storage = InMemoryObjectStorage()

    with session_scope() as db:
        category = db.query(JewelleryCategory).filter(JewelleryCategory.slug == "ring").first()
        item = Jewellery(
            category_id=category.id,
            name=f"Worker Test Ring {unique_suffix}",
            slug=f"worker-test-ring-{unique_suffix}",
            sku=f"WORKER-{unique_suffix}",
        )
        db.add(item)
        db.flush()

        original_key = f"jewellery/{item.id}/original/test.jpg"
        storage.upload(original_key, io.BytesIO(original_bytes), content_type="image/jpeg")
        original = JewelleryAsset(
            jewellery_id=item.id,
            asset_type=AssetType.original,
            storage_key=original_key,
            mime_type="image/jpeg",
            width_px=400,
            height_px=400,
            file_size_bytes=len(original_bytes),
            processing_status=ProcessingStatus.ready,
        )
        processed = JewelleryAsset(
            jewellery_id=item.id,
            asset_type=AssetType.processed,
            storage_key=f"pending/placeholder-{unique_suffix}",
            processing_status=ProcessingStatus.pending,
        )
        db.add(original)
        db.add(processed)
        db.flush()
        item_id = str(item.id)
        processed_id = str(processed.id)

    job = CatalogueAssetProcessingJob.create(asset_id=processed_id, jewellery_id=item_id)
    yield job, storage

    with session_scope() as db:
        db.query(JewelleryAsset).filter(JewelleryAsset.jewellery_id == item_id).delete()
        row = db.get(Jewellery, item_id)
        if row:
            db.delete(row)


def test_load_rows_finds_original_and_processed(seeded_asset_pair):
    job, _storage = seeded_asset_pair
    with session_scope() as db:
        processed_asset, original_asset = _load_rows(db, job)
        assert str(processed_asset.id) == job.asset_id
        assert original_asset.asset_type == AssetType.original


def test_load_rows_raises_for_missing_asset():
    fake_job = CatalogueAssetProcessingJob.create(
        asset_id="00000000-0000-0000-0000-000000000000", jewellery_id="00000000-0000-0000-0000-000000000000"
    )
    with session_scope() as db:
        with pytest.raises(AssetRowMissingError):
            _load_rows(db, fake_job)


def test_process_one_job_success_path_marks_ready_with_real_output(seeded_asset_pair):
    job, storage = seeded_asset_pair
    processor = CatalogueAssetProcessor(get_remover("rembg_u2net"))

    timings = process_one_job(job, processor=processor, storage=storage, queue_wait_seconds=0.05)
    assert timings.total_seconds > 0

    with session_scope() as db:
        processed_asset = db.get(JewelleryAsset, job.asset_id)
        assert processed_asset.processing_status == ProcessingStatus.ready
        assert processed_asset.processing_error is None
        assert processed_asset.mime_type == "image/png"
        assert processed_asset.width_px is not None
        assert processed_asset.file_size_bytes > 0
        assert not processed_asset.storage_key.startswith("pending/")

        # A sibling thumbnail row was created.
        thumbnail = (
            db.query(JewelleryAsset)
            .filter(
                JewelleryAsset.jewellery_id == processed_asset.jewellery_id,
                JewelleryAsset.asset_type == AssetType.thumbnail,
            )
            .first()
        )
        assert thumbnail is not None
        assert thumbnail.processing_status == ProcessingStatus.ready

        # Capture the keys while the rows are still attached to a live session — using
        # them after the `with` block exits would raise DetachedInstanceError.
        processed_storage_key = processed_asset.storage_key
        thumbnail_storage_key = thumbnail.storage_key

    # The processed/thumbnail bytes genuinely exist in storage under their new keys.
    assert storage.exists(processed_storage_key)
    assert storage.exists(thumbnail_storage_key)
    processed_bytes = storage.download(processed_storage_key)
    assert processed_bytes[:8] == b"\x89PNG\r\n\x1a\n"  # real PNG file signature


def test_process_one_job_failure_path_marks_failed_with_safe_message(seeded_asset_pair):
    job, storage = seeded_asset_pair
    process_one_job(job, processor=_AlwaysFailsProcessor(), storage=storage, queue_wait_seconds=0.01)

    with session_scope() as db:
        processed_asset = db.get(JewelleryAsset, job.asset_id)
        assert processed_asset.processing_status == ProcessingStatus.failed
        assert processed_asset.processing_error
        # The safe message must never contain the raw internal exception text.
        assert "synthetic processing failure for testing" not in processed_asset.processing_error


def test_process_one_job_missing_asset_row_does_not_raise(unique_suffix):
    """If the asset row was deleted between enqueue and dequeue (e.g. an admin deleted
    the jewellery item), the consumer must log and move on, not crash the loop."""
    fake_job = CatalogueAssetProcessingJob.create(
        asset_id="00000000-0000-0000-0000-000000000000", jewellery_id="00000000-0000-0000-0000-000000000000"
    )
    storage = InMemoryObjectStorage()
    processor = _AlwaysFailsProcessor()
    # Should not raise.
    process_one_job(fake_job, processor=processor, storage=storage, queue_wait_seconds=0.0)
