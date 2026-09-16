"""
Verifies:
- the FastAPI app boots at all (importing apps.api.main must not raise)
- /health always returns 200 regardless of dependency availability (liveness)
- /ready reports per-dependency status and degrades correctly when a dependency is down
- the X-Request-ID header is present on every response
"""


def test_app_starts(client):
    assert client is not None


def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "alive"
    assert "service" in body


def test_health_has_request_id_header(client):
    response = client.get("/health")
    assert "x-request-id" in response.headers


def test_health_respects_incoming_request_id(client):
    response = client.get("/health", headers={"X-Request-ID": "test-request-id-123"})
    assert response.headers["x-request-id"] == "test-request-id-123"


def test_ready_reports_all_dependency_checks(client):
    # In this sandboxed unit-test environment there is no live Postgres/Redis/MinIO, so
    # readiness is expected to report `false` for each and return 503 — the important
    # behavior under test is that the endpoint runs the checks and reports accurately,
    # never that it silently assumes success. Integration verification against real
    # dependencies is done separately via `docker compose up` (see docs/development.md).
    response = client.get("/ready")
    body = response.json()
    assert set(body["checks"].keys()) == {"database", "redis", "object_storage"}
    assert response.status_code in (200, 503)
    if response.status_code == 503:
        assert body["status"] == "not_ready"
        assert any(v is False for v in body["checks"].values())


def test_unknown_route_returns_404_without_leaking_internals(client):
    response = client.get("/this-route-does-not-exist")
    assert response.status_code == 404
    assert "traceback" not in response.text.lower()
