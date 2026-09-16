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
from workers.tasks.process_jewellery_asset import run_consumer_loop

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


def _consumer_loop() -> None:
    # Uses its own Redis connection (blocking BLPOP calls must not share a client with
    # the heartbeat's SET calls on another thread).
    consumer_redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        run_consumer_loop(consumer_redis_client, _stop_event, poll_timeout_seconds=5)
    except Exception:
        logger.exception("Catalogue asset consumer loop crashed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    heartbeat_thread = threading.Thread(target=_heartbeat_loop, daemon=True, name="heartbeat")
    heartbeat_thread.start()
    logger.info("Worker heartbeat loop started")

    consumer_thread = threading.Thread(target=_consumer_loop, daemon=True, name="catalogue-asset-consumer")
    consumer_thread.start()
    logger.info("Catalogue asset processing consumer thread started")

    yield

    _stop_event.set()
    heartbeat_thread.join(timeout=5)
    consumer_thread.join(timeout=10)
    logger.info("Worker heartbeat loop and consumer thread stopped")


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
