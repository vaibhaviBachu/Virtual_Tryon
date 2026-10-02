"""
Minimal fixed-window rate limiting on top of the existing Redis client
(apps/api/core/redis_client.py). First use of Redis for this purpose in this codebase
-- that module's own docstring already anticipated it ("Milestone 1 uses Redis ... to
give later milestones (rate limiting, ...) one place to get a client from").

Deliberately a plain INCR+EXPIRE fixed window, not a sliding window or token bucket --
the AI Jewellery Assistant endpoints this guards are cost-control for a paid external
API, not a precision traffic-shaping problem, and a fixed window is the smallest thing
that is honestly a rate limit.
"""
import redis


class RateLimitExceededError(Exception):
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        super().__init__(f"Rate limit exceeded: {limit} requests per {window_seconds}s")


def enforce_rate_limit(
    redis_client: redis.Redis, key: str, *, limit: int, window_seconds: int = 3600
) -> None:
    """Raises RateLimitExceededError once `key` has been incremented more than `limit`
    times within the current `window_seconds` window. The window starts the moment the
    first request in it arrives (not aligned to the clock)."""
    current = redis_client.incr(key)
    if current == 1:
        redis_client.expire(key, window_seconds)
    if current > limit:
        raise RateLimitExceededError(limit, window_seconds)
