FROM python:3.11-slim

WORKDIR /srv

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY workers/requirements.txt /srv/workers/requirements.txt
RUN pip install --no-cache-dir -r /srv/workers/requirements.txt

COPY workers /srv/workers
COPY ai /srv/ai
COPY db /srv/db
COPY storage /srv/storage
COPY jobqueue /srv/jobqueue

ENV PYTHONPATH=/srv \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "workers.main:app", "--host", "0.0.0.0", "--port", "8000"]
