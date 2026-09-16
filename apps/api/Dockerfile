FROM python:3.11-slim

WORKDIR /srv

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/requirements.txt /srv/apps/api/requirements.txt
RUN pip install --no-cache-dir -r /srv/apps/api/requirements.txt

# db/ is the shared ORM package (both api and worker import it, but never each other
# — see db/base.py). ai/ carries the catalogue asset-processing pipeline (Milestone 2)
# and the (still-unimplemented) try-on engines.
COPY apps/api /srv/apps/api
COPY ai /srv/ai
COPY db /srv/db
COPY storage /srv/storage
COPY jobqueue /srv/jobqueue
# scripts/ (e.g. scripts/seed_admin.py) is a dev/ops utility meant to be run inside this
# container via `docker compose exec api python scripts/...` — omitted before, which
# made that a genuine "file not found" in the real container (caught for real running
# on a real machine, not assumed).
COPY scripts /srv/scripts

RUN chmod +x /srv/apps/api/entrypoint.sh

ENV PYTHONPATH=/srv \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["/srv/apps/api/entrypoint.sh"]
