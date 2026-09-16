"""
Worker process entrypoint.

Milestone 1 scope: an independent process (separate container, separate deployable from
the API — see docs/architecture.md §9) that proves out heartbeat/health plumbing.

Milestone 4+ will add: a real queue consumer (Celery/RQ/Arq — decision deferred, not
needed until there's an actual job to run) that pops tryon_requests jobs and calls
`ai.engines.registry.get_engine(...).render(...)`. That code will live in
`workers/tasks/` and will import from `ai/`, never the other way around, and never from
`apps/api` directly (both talk to Postgres/Redis/storage via their own clients, keeping
the API <-> worker boundary limited to the queue and the database).
"""
import asyncio
import logging
import signal
import threading
from contextlib import asynccontextmanager

import redis
import uvicorn
from fastapi import FastAPI

from workers.config import get_worker_settings
from workers.heartbeat import Heartbeat

logger = logging.getLogger("worker.main")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = get_worker_settings()
redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
heartbeat = Heartbeat(redis_client, interval_seconds=settings.HEARTBEAT_INTERVAL_SECONDS)

_stop_event = threading.Event()


def _heartbeat_loop() -> None:
    while not _stop_event.is_set():
        try:
            heartbeat.beat()
        except Exception:
            logger.warning("Heartbeat write failed (is Redis reachable?)", exc_info=True)
        _stop_event.wait(settings.HEARTBEAT_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    thread = threading.Thread(target=_heartbeat_loop, daemon=True, name="heartbeat")
    thread.start()
    logger.info("Worker heartbeat loop started")
    yield
    _stop_event.set()
    thread.join(timeout=5)
    logger.info("Worker heartbeat loop stopped")


app = FastAPI(title="jewellery-virtual-tryon-worker", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    """Liveness: is the worker process itself alive (independent of Redis)."""
    return {"status": "alive", "service": "worker"}


@app.get("/ready")
def ready() -> dict:
    """Readiness: is the heartbeat loop actually reaching Redis."""
    max_age = settings.HEARTBEAT_INTERVAL_SECONDS * 5
    alive = heartbeat.is_alive(max_age_seconds=max_age)
    return {"status": "ready" if alive else "not_ready", "heartbeat_alive": alive}


def _handle_signal(signum, frame) -> None:
    logger.info("Received shutdown signal", extra={"signal": signum})
    _stop_event.set()


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT, _handle_signal)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
