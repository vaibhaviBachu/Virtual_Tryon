"""
Structured JSON logging with request-ID propagation.

Every log line is a single JSON object so it can be ingested by any log aggregator without
a custom parser. The request ID set by `RequestIDMiddleware` (see core/middleware.py) is
attached via a contextvar so any log statement emitted while handling a request automatically
carries it — this is the foundation the future API -> queue -> worker trace will build on
(the request/job id is what gets forwarded into the Redis job payload in later milestones).
"""
import contextvars
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict

request_id_ctx_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_ctx_var.get(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        # Allow callers to attach structured extras: logger.info("x", extra={"extra_fields": {...}})
        extra_fields = getattr(record, "extra_fields", None)
        if extra_fields:
            payload.update(extra_fields)
        return json.dumps(payload, default=str)


def configure_logging(log_level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(log_level.upper())

    # Avoid duplicate handlers on reload (uvicorn --reload re-imports the module).
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root.addHandler(handler)

    # Keep noisy third-party loggers at a sane level rather than DEBUG-flooding stdout.
    for noisy in ("uvicorn.access", "watchfiles", "botocore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
