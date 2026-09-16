"""
Request-ID middleware and centralized exception handling.

- Every response carries an `X-Request-ID` header (client-supplied or generated).
- Unhandled exceptions never leak stack traces, file paths, or internal details to the
  client; they are logged in full server-side and returned as a structured, generic
  JSON error body.
"""
import logging
import uuid

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from apps.api.core.logging import request_id_ctx_var

logger = logging.getLogger("app.errors")


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        token = request_id_ctx_var.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_ctx_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        return response


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": "validation_error",
                "message": "The request could not be validated.",
                "details": exc.errors(),
                "request_id": request_id_ctx_var.get(),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        # Full detail goes to the structured logs only — never to the client.
        logger.exception(
            "Unhandled exception while processing request",
            extra={"extra_fields": {"path": request.url.path}},
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": "internal_server_error",
                "message": "An unexpected error occurred. Please try again later.",
                "request_id": request_id_ctx_var.get(),
            },
        )
