import pytest

from agent.ops import store


@pytest.fixture(autouse=True)
def _reset():
    store.reset()
    yield
    store.reset()


def test_snapshot_returns_all_five_services():
    services = store.snapshot()
    assert len(services) == 5
    assert {s["name"] for s in services} == {
        "api-gateway", "checkout-service", "payments-worker", "auth-service", "search-index",
    }


def test_get_unknown_service_returns_none():
    assert store.get("nonexistent") is None


def test_restart_clears_error_state_and_revives_zero_replicas():
    before = store.get("search-index")
    assert before["status"] == "down"
    assert before["replicas"] == 0

    after = store.restart("search-index")
    assert after["status"] == "healthy"
    assert after["error_rate_pct"] < before["error_rate_pct"]
    assert after["replicas"] >= 1


def test_scale_updates_replica_count_only():
    before = store.get("api-gateway")
    after = store.scale("api-gateway", 6)
    assert after["replicas"] == 6
    assert after["version"] == before["version"]


def test_rollback_updates_version_and_heals_status():
    after = store.rollback("checkout-service", "1.8.0")
    assert after["version"] == "1.8.0"
    assert after["status"] == "healthy"


def test_mutations_are_visible_through_snapshot():
    store.scale("auth-service", 5)
    snap = {s["name"]: s for s in store.snapshot()}
    assert snap["auth-service"]["replicas"] == 5
