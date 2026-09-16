"""
Redis connection helper.

Milestone 1 uses Redis only for infrastructure readiness (the /ready check) and to give
later milestones (rate limiting, job queue, caching) one place to get a client from,
rather than each feature module opening its own connection. No business logic — job
queue producers/consumers, rate-limit counters — is implemented here yet.
"""
import logging

import redis

from apps.api.core.config import get_settings

logger = logging.getLogger("app.redis")

settings = get_settings()
_redis_pool = redis.ConnectionPool.from_url(settings.REDIS_URL, decode_responses=True)


def get_redis_client() -> redis.Redis:
    return redis.Redis(connection_pool=_redis_pool)


def check_redis_connection() -> bool:
    try:
        client = get_redis_client()
        return bool(client.ping())
    except Exception:
        logger.warning("Redis readiness check failed", exc_info=True)
        return False
