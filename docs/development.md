# Development Guide

## Repository layout

See `README.md` for the top-level map and `docs/architecture.md` for the full rationale.
The one rule that matters most day to day: **`apps/api` never imports from `ai/`
directly, and neither does `apps/api` know about queueing.** The chain is always
`apps/api -> (Postgres/Redis) -> workers -> ai`. If you find yourself importing an `ai/`
module from a router or service in `apps/api`, stop — that logic belongs in `workers/`.

## Running the stack

### Docker Compose (intended path)

```bash
cp .env.example .env
docker compose build
docker compose up
```

### Without Docker (for fast iteration on one service)

Backend:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt -r workers/requirements.txt
export DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:2003/jewellery_tryon
export REDIS_URL=redis://localhost:2004/0
export MINIO_ENDPOINT=localhost:2005
alembic -c apps/api/alembic.ini upgrade head
uvicorn apps.api.main:app --reload --port 2002
```
(Postgres/Redis/MinIO can either be the Docker Compose containers, or — as was done to
verify this milestone in a Docker-less sandbox, see below — native `postgresql`/
`redis-server` installs and a local S3-compatible mock.)

Worker:
```bash
uvicorn workers.main:app --reload --port 2007
```

Frontend:
```bash
cd apps/web
npm install
npm run dev
```

## Testing

```bash
# Backend + AI + worker (from repo root, venv active)
pytest

# Frontend
cd apps/web
npm run lint
npm run test
npm run build
```

## How Milestone 1 was verified

Full transparency on what was and wasn't run, per the project's "do not claim something
works unless you tested it" rule:

1. **`docker compose config`** — validated the compose file parses and resolves
   correctly. Passed.
2. **`docker compose build`** — attempted and failed: every base image
   (`python:3.11-slim`, `postgres:16-alpine`, `redis:7-alpine`, `minio/minio:latest`,
   `node:22-slim`) returned `403 Forbidden` when pulled, because the sandbox this was
   built in blocks all container registries (Docker Hub, GHCR, GCR, Quay, MCR, ECR
   Public were all tested and all blocked) at the network policy level. This is an
   environment limitation, not a problem with the Dockerfiles or compose file.
3. **To still get real verification instead of just "the files exist,"** the same
   dependencies were run as native OS processes in the sandbox (where `apt` access to
   the Ubuntu archive mirror *is* allowed) and the real application code was pointed at
   them:
   - `apt-get install postgresql redis-server`, both started as system services.
   - `pip install moto[server]` — a pure-Python S3-API-compatible mock server — run
     locally in place of MinIO (MinIO's own binary download is also blocked by the same
     registry-style egress rule).
   - `alembic -c apps/api/alembic.ini upgrade head` run against the real local Postgres —
     succeeded, `pgcrypto` extension confirmed created, `alembic_version` table confirmed
     at revision `20260916_0001`.
   - `uvicorn apps.api.main:app` started against the real Postgres/Redis/mock-S3 —
     `GET /health` returned `{"status":"alive",...}`; `GET /ready` returned
     `{"status":"ready","checks":{"database":true,"redis":true,"object_storage":true}}`
     with HTTP 200.
   - Postgres was then stopped and `/ready` was re-checked: it correctly returned
     `{"status":"not_ready","checks":{"database":false,...}}` with **HTTP 503** — proving
     the check is real, not hard-coded to succeed. Postgres was restarted and `/ready`
     recovered to 200 on the next call.
   - `uvicorn workers.main:app` was started for real: `GET /health` returned alive
     immediately (independent of Redis, as designed); `GET /ready` returned
     `heartbeat_alive: true` after the heartbeat loop had written to the real Redis
     instance.
4. **Automated test suites** were run for real (not just written): 21 backend/AI/worker
   pytest tests passed; 5 frontend Vitest tests passed; ESLint reported zero
   warnings/errors; `next build` produced a working production build with all three
   routes (`/`, `/try-on`, `/admin`) prerendering successfully.

**What this means for you:** the application code, migration, and test suites are
verified against real dependencies. The one thing that is *not* yet verified is the
Docker image build/orchestration itself — run `docker compose build && docker compose up`
on a machine with normal internet access as your first step, and report back if
anything differs from the native-process verification above (it shouldn't, since the
Dockerfiles install the same package versions pinned in `requirements.txt`/
`package.json`, but this is the one claim in this document that rests on the compose
file being correct rather than on a direct test run).

## How Milestone 2 was verified

See [`docs/milestone-2-verification.md`](milestone-2-verification.md) for the complete,
itemized account (migration, 76 backend tests, 27 frontend tests, a real bug found and
fixed, and an honest account of SAM2 being blocked in this sandbox). The short version:
the same native-process strategy as Milestone 1, plus `moto_server` (a pure-Python
S3-API-compatible mock, run with `moto_server -p 2005`) standing in for MinIO, since
MinIO's own binary download is blocked by the same registry-style egress rule that
blocks Docker Hub.

To create an admin account for testing the `/admin/catalogue` UI (there is no
self-service registration endpoint by design — see Milestone 2's narrow auth scope):
```bash
python scripts/seed_admin.py --email admin@example.com --password 'your-password-here'
```

## Known limitations

- Google Fonts (`next/font/google`) could not be fetched in the build sandbox for the
  same egress reason as the Docker registries; `apps/web` currently uses a system font
  stack (see `apps/web/src/app/globals.css`). This is a Milestone 7 branding-pass item,
  not a functional gap.
- SAM2 (Milestone 0's pick for catalogue background removal) is blocked in this sandbox
  (huggingface.co returns 403) — Milestone 2 ships a real, license-verified substitute
  (`rembg`/U-2-Net) instead. See `docs/milestone-2-verification.md` §7.
- No Milestone 3+ code exists yet (user-photo landmarks/segmentation, geometry engine,
  virtual try-on rendering) — see `docs/roadmap.md` for what ships in which milestone.
