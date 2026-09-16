"""
Milestone 4 — geometry/compositing try-on mathematics.

Pure, independently-testable functions (spec §28: "put all geometry mathematics into
independently testable functions... do not hide all calculations inside one large
function"). Nothing in this package touches a database, object storage, Redis, or
FastAPI — see ai/engines/geometry/engine.py for the TryOnEngine adapter that wires this
package to the rest of the system, and workers/tasks/process_tryon_render.py for the
only place that builds a TryOnInput from real ORM rows/storage bytes.
"""
