#!/usr/bin/env sh
# Runs pending Alembic migrations before the API starts serving traffic. Postgres is
# already known-healthy at this point (docker-compose's `depends_on: condition:
# service_healthy`), so this only waits out the brief window between "accepting TCP
# connections" and "ready for our migration transaction."
set -e

echo "[entrypoint] running database migrations..."
alembic -c apps/api/alembic.ini upgrade head

echo "[entrypoint] starting API server..."
exec uvicorn apps.api.main:app --host 0.0.0.0 --port 8000
