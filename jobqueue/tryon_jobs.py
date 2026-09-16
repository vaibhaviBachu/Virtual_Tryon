"""
Job envelope for tryon (user-photo understanding) processing — mirrors
jobqueue/catalogue_jobs.py's minimal Redis-list pattern exactly (see that module's
docstring for why this is deliberately not a full Celery/RQ/Arq framework yet). A
second, distinct queue key is used so the worker can run separate consumer threads for
catalogue-asset jobs and tryon-request jobs without either blocking the other.
"""
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Optional

import redis

logger = logging.getLogger("jobqueue.tryon")

QUEUE_KEY = "queue:tryon_request_processing"


@dataclass
class TryOnRequestProcessingJob:
    job_id: str
    request_id: str
    session_id: str
    enqueued_at: float

    @classmethod
    def create(cls, request_id: str, session_id: str) -> "TryOnRequestProcessingJob":
        return cls(
            job_id=str(uuid.uuid4()),
            request_id=request_id,
            session_id=session_id,
            enqueued_at=time.time(),
        )

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "TryOnRequestProcessingJob":
        return cls(**json.loads(raw))


def enqueue_tryon_job(redis_client: redis.Redis, job: TryOnRequestProcessingJob) -> None:
    redis_client.rpush(QUEUE_KEY, job.to_json())
    logger.info(
        "Enqueued tryon request processing job",
        extra={"extra_fields": {"job_id": job.job_id, "request_id": job.request_id}},
    )


def dequeue_tryon_job(redis_client: redis.Redis, timeout_seconds: int = 5) -> Optional[TryOnRequestProcessingJob]:
    result = redis_client.blpop([QUEUE_KEY], timeout=timeout_seconds)
    if result is None:
        return None
    _key, raw = result
    return TryOnRequestProcessingJob.from_json(raw)
