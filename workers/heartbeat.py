"""
Minimal heartbeat mechanism: the worker process writes its liveness timestamp to Redis
on an interval. This is intentionally NOT a job queue consumer yet — Milestone 1's only
job is to prove the worker is an independently running, independently healthy process
that FastAPI/API code never talks to directly (only through Redis/the future queue).
"""
import logging
import time
from typing import Optional

import redis

logger = logging.getLogger("worker.heartbeat")

HEARTBEAT_KEY = "worker:heartbeat:last_seen"


class Heartbeat:
    def __init__(self, redis_client: redis.Redis, interval_seconds: float = 5.0) -> None:
        self._redis = redis_client
        self._interval = interval_seconds

    def beat(self) -> None:
        self._redis.set(HEARTBEAT_KEY, str(time.time()), ex=int(self._interval * 5))

    def last_seen(self) -> Optional[float]:
        value = self._redis.get(HEARTBEAT_KEY)
        return float(value) if value is not None else None

    def is_alive(self, max_age_seconds: float) -> bool:
        last = self.last_seen()
        if last is None:
            return False
        return (time.time() - last) <= max_age_seconds
