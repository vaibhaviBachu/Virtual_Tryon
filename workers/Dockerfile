FROM python:3.11-slim

WORKDIR /srv

# libgomp1: required by onnxruntime/mediapipe's native ops.
# libgl1, libglib2.0-0, libsm6, libxext6, libxrender1, libxcb1: required at import time
# by opencv-contrib-python (mediapipe's own pinned OpenCV dependency, a full/GUI build,
# not opencv-python-headless) even though this worker never opens a GUI window or
# display — cv2's shared library still dynamically links against these X11/GL libs on
# import. Without them, `import cv2` fails with `ImportError: libxcb.so.1: cannot open
# shared object file` inside this slim base image (confirmed for real via
# `docker compose logs worker` on a real machine with normal internet access — Docker
# build/run could not be verified in the sandbox this project was developed in, so this
# was only caught once run for real; see docs/milestone-4-verification.md's Docker
# verification note).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl libgomp1 libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libxcb1 \
    && rm -rf /var/lib/apt/lists/*

COPY workers/requirements.txt /srv/workers/requirements.txt
RUN pip install --no-cache-dir -r /srv/workers/requirements.txt

# Pre-fetch rembg's U-2-Net ONNX weights (~176MB) at build time instead of leaving them
# to download on first use. RembgBackgroundRemover.__init__ (ai/catalogue/background_remover.py)
# calls rembg.new_session("u2net"), which otherwise downloads this from a GitHub release
# the moment the catalogue-asset consumer thread starts (workers/tasks/process_jewellery_asset.py) —
# on a free/ephemeral host that download re-runs on every cold start, blocking that
# thread (silently: pooch's tqdm progress bar is carriage-return based and produces no
# visible log lines) for as long as it takes, before the thread ever logs "consumer loop
# started" or picks up a single job. Baking it into the image means the model is already
# on disk at container start, so this is a one-time build-time cost instead of a
# recurring runtime one.
RUN python -c "from rembg import new_session; new_session('u2net')"

COPY workers /srv/workers
COPY ai /srv/ai
COPY db /srv/db
COPY storage /srv/storage
COPY jobqueue /srv/jobqueue
# evaluation/: not imported by the running worker process itself, but this image is
# where `python -m evaluation.debug_necklace` and `python -m evaluation.run_geometry`
# must be run from (they need this image's cv2/mediapipe dependencies, which apps/api's
# image deliberately does not have) — see evaluation/debug_necklace.py's docstring.
COPY evaluation /srv/evaluation

ENV PYTHONPATH=/srv \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "workers.main:app", "--host", "0.0.0.0", "--port", "8000"]
