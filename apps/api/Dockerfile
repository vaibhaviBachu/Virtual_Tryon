FROM python:3.11-slim

WORKDIR /srv

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/requirements.txt /srv/apps/api/requirements.txt
RUN pip install --no-cache-dir -r /srv/apps/api/requirements.txt

# ai/ is copied in even though Milestone 1 doesn't import it yet, so the worker/api
# import boundary (apps/api -> workers -> ai) is exercised by the build from day one.
COPY apps/api /srv/apps/api
COPY ai /srv/ai

RUN chmod +x /srv/apps/api/entrypoint.sh

ENV PYTHONPATH=/srv \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["/srv/apps/api/entrypoint.sh"]
