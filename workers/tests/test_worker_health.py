import fakeredis
from fastapi.testclient import TestClient

import workers.main as worker_main
from workers.heartbeat import Heartbeat


def test_worker_health_endpoint_is_independent_of_redis():
    client = TestClient(worker_main.app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "alive"


def test_heartbeat_reports_not_alive_when_never_beaten():
    fake_client = fakeredis.FakeRedis(decode_responses=True)
    hb = Heartbeat(fake_client, interval_seconds=1.0)
    assert hb.is_alive(max_age_seconds=5) is False


def test_heartbeat_reports_alive_after_beat():
    fake_client = fakeredis.FakeRedis(decode_responses=True)
    hb = Heartbeat(fake_client, interval_seconds=1.0)
    hb.beat()
    assert hb.is_alive(max_age_seconds=5) is True
