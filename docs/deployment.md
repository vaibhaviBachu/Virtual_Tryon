# Deployment Guide

Status: Milestone 1. This document describes the target deployment shape from
`docs/architecture.md` §9 for reference; **no staging/production environment has been
provisioned yet** — that is Milestone 7 scope. Nothing below should be read as "already
deployed."

## Development

`docker compose up` on a single machine, as described in `README.md`. All state
(Postgres, Redis, MinIO) persists in local Docker volumes.

## Staging (planned, not provisioned)

- Same container images as production, deployed to a single small VM or a managed
  container platform (e.g., Fly.io, Render, a single-node ECS service).
- Managed Postgres and managed Redis are recommended even at staging, to catch
  connection-pooling/latency differences from local Docker networking early.
- Object storage: a real S3 or Cloudflare R2 bucket (not MinIO), so signed-URL behavior
  matches production.

## Production (planned, not provisioned)

- **Web:** static/edge-deployed (e.g., Vercel, or a CDN-fronted Next.js deployment).
- **API:** containerized, horizontally scaled behind a load balancer. Stateless — safe
  to scale out without sticky sessions.
- **Workers:** a separate node pool from the API. The Milestone 1–4 geometry engine
  needs no GPU at all (see `docs/production-readiness.md` §1); a GPU pool is only added
  later if a generative refinement engine is approved by the Milestone 5 evaluation gate.
- **Postgres:** managed (RDS/Cloud SQL/Supabase). A read replica is added only if
  analytics load demands it — not on day one.
- **Redis:** managed (ElastiCache/Upstash).
- **Object storage:** S3 or Cloudflare R2, with a CDN in front of public catalogue-asset
  paths only — user photos and try-on results are never public (see
  `docs/production-readiness.md` §3).

## Configuration across environments

Every environment reads the same variable names (`.env.example`); only the values
differ. Production secrets (JWT signing key, database credentials, storage keys) must
come from a secret manager (e.g., AWS Secrets Manager, Doppler, or the hosting
platform's own secret store) — never from a committed file.

## Scaling strategy

API and worker pools scale independently and horizontally. Redis queue depth (once a
real job queue exists — Milestone 4+) is the intended autoscaling signal for the worker
pool; API pool scaling follows ordinary request-latency/CPU metrics.

## CI/CD

Not implemented yet — scoped to Milestone 7 (`docs/roadmap.md`). At minimum this will
run `pytest`, `npm run lint`, `npm run test`, and `npm run build` on every PR, plus
`docker compose build` to catch image-level breakage (which, per
`docs/development.md`, was the one thing this milestone's build sandbox could not
verify directly).
