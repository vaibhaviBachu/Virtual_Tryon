# Roadmap — Milestone-by-Milestone Plan

**Milestone 0 — Architecture & Research (this deliverable).** Output: this `docs/` set. No app code.
Gate: user review and sign-off before any implementation begins.

**Milestone 1 — Platform Foundation.** Monorepo scaffold, Next.js app shell, FastAPI app shell,
Postgres + Alembic baseline migration, Redis, MinIO, docker-compose (ports per architecture.md §2),
env config, structured logging, `/health` + `/ready`. No jewellery logic yet — this is pure
plumbing, verified by: all containers start clean on a fresh machine via `docker compose up`.

**Milestone 2 — Jewellery Catalogue.** Categories + jewellery CRUD, admin asset upload endpoint,
asset-processing pipeline (background removal via SAM2, thumbnailing, metadata capture), minimal
admin UI to manage catalogue. Verified by: an admin can upload a jewellery photo and see a
transparent cutout + thumbnail + metadata generated automatically.

**Milestone 3 — User Image Pipeline.** Camera capture + upload in the frontend, upload validation
(format/size/resolution/corruption/orientation/EXIF-strip), MediaPipe face/hand/pose landmark
integration, segmentation integration. Verified by: given a test photo, the API returns landmark
coordinates and segmentation masks with measurable confidence scores.

**Milestone 4 — Basic (Geometry) Try-On.** `GeometryTryOnEngine` implemented for at least earrings
and necklaces: anchor computation, scale/rotation from landmarks, warp + composite. Verified against
the `evaluation/` dataset with tracked scale-error and placement-error metrics, not eyeballing.

**Milestone 5 — Expand Categories + Evaluation-Driven Model Decision.** Add bangles, bracelets,
rings, maang tikka, nose rings, jewellery sets to the geometry engine. Run the evaluation harness
geometry-only vs. any generative candidate assembled as a spike; only proceed to build a
`GenerativeTryOnEngine`/`HybridTryOnEngine` if the harness shows a measurable, licensing-clean
improvement — this milestone is a **decision gate**, not an assumption that generative AI ships.

**Milestone 6 — Occlusion & Quality.** Hair-over-jewellery and cloth-over-jewellery occlusion
compositing using segmentation masks, shadow/lighting synthesis pass, optional scoped generative
harmonization pass (masked, jewellery-protected) if Milestone 5's gate approved it.

**Milestone 7 — Production Hardening.** Full auth/authorization, rate limiting, retention/lifecycle
policies, monitoring/error tracking wired end to end, full test suites (backend/frontend/AI),
backup strategy for Postgres, CI/CD pipeline, staging → production deployment per
`architecture.md` §9.

Each milestone ends with a short written verification note (what was tested, what passed/failed) —
per the spec's rule that nothing is called complete without having been tested.
