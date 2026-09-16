"""
Minimal Redis-backed job queue for catalogue asset processing.

Milestone 1 deliberately deferred picking a full job-queue framework (Celery/RQ/Arq) —
there was no job to run yet. Milestone 2 has a real one (background removal), so this
implements the smallest thing that is honestly a queue: a Redis list used with
RPUSH (producer, in apps/api) and BLPOP (consumer, in workers), plus a JSON envelope
with a job id for tracing. This is intentionally NOT a general-purpose task framework —
if a second job type appears in a later milestone (e.g. the actual try-on render job in
Milestone 4), evaluate Celery/RQ/Arq then rather than growing this ad hoc, per
docs/architecture.md §5's "select a suitable Python worker framework after evaluation."

Both apps/api and workers import this module directly (neither imports the other) —
same shared-infrastructure pattern as db/ and storage/.
"""
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Optional

import redis

logger = logging.getLogger("jobqueue.catalogue")

QUEUE_KEY = "queue:catalogue_asset_processing"


@dataclass
class CatalogueAssetProcessingJob:
    job_id: str
    asset_id: str
    jewellery_id: str
    enqueued_at: float

    @classmethod
    def create(cls, asset_id: str, jewellery_id: str) -> "CatalogueAssetProcessingJob":
        return cls(
            job_id=str(uuid.uuid4()),
            asset_id=asset_id,
            jewellery_id=jewellery_id,
            enqueued_at=time.time(),
        )

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "CatalogueAssetProcessingJob":
        return cls(**json.loads(raw))


def enqueue_job(redis_client: redis.Redis, job: CatalogueAssetProcessingJob) -> None:
    redis_client.rpush(QUEUE_KEY, job.to_json())
    logger.info(
        "Enqueued catalogue asset processing job",
        extra={"extra_fields": {"job_id": job.job_id, "asset_id": job.asset_id}},
    )


def dequeue_job(redis_client: redis.Redis, timeout_seconds: int = 5) -> Optional[CatalogueAssetProcessingJob]:
    """Blocks up to `timeout_seconds` waiting for a job. Returns None on timeout (the
    caller loops) rather than raising — an empty queue is the normal, expected state."""
    result = redis_client.blpop([QUEUE_KEY], timeout=timeout_seconds)
    if result is None:
        return None
    _key, raw = result
    return CatalogueAssetProcessingJob.from_json(raw)
