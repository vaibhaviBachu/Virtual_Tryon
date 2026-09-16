"""
Job envelope for Milestone 4 render (jewellery placement) processing — mirrors
jobqueue/tryon_jobs.py's minimal Redis-list pattern exactly, on its own queue key so a
slow render job never competes with Milestone 3's "understand this photo" queue or the
catalogue-asset queue (each gets its own worker consumer thread — see workers/main.py).
"""
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Optional

import redis

logger = logging.getLogger("jobqueue.render")

QUEUE_KEY = "queue:tryon_render_processing"


@dataclass
class TryOnRenderJob:
    job_id: str
    render_id: str
    request_id: str
    enqueued_at: float

    @classmethod
    def create(cls, render_id: str, request_id: str) -> "TryOnRenderJob":
        return cls(job_id=str(uuid.uuid4()), render_id=render_id, request_id=request_id, enqueued_at=time.time())

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "TryOnRenderJob":
        return cls(**json.loads(raw))


def enqueue_render_job(redis_client: redis.Redis, job: TryOnRenderJob) -> None:
    redis_client.rpush(QUEUE_KEY, job.to_json())
    logger.info(
        "Enqueued tryon render job",
        extra={"extra_fields": {"job_id": job.job_id, "render_id": job.render_id}},
    )


def dequeue_render_job(redis_client: redis.Redis, timeout_seconds: int = 5) -> Optional[TryOnRenderJob]:
    result = redis_client.blpop([QUEUE_KEY], timeout=timeout_seconds)
    if result is None:
        return None
    _key, raw = result
    return TryOnRenderJob.from_json(raw)
