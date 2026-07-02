import json

import pytest

from agent.ops import store
from agent.ops.tools import (
    RISKY_TOOL_NAMES,
    TOOLS,
    TOOLS_BY_NAME,
    get_metrics,
    get_service_status,
    list_incidents,
    restart_service,
    rollback_deploy,
    scale_service,
    search_logs,
    think,
)


@pytest.fixture(autouse=True)
def _reset():
    store.reset()
    yield
    store.reset()


def test_think_returns_ack():
    assert think.invoke({"thought": "checking checkout-service"}) == "noted"


def test_get_service_status_returns_known_service_json():
    out = json.loads(get_service_status.invoke({"service": "api-gateway"}))
    assert out["name"] == "api-gateway"
    assert "status" in out


def test_get_service_status_unknown_service_reports_error():
    out = json.loads(get_service_status.invoke({"service": "nonexistent"}))
    assert "error" in out


def test_get_metrics_includes_requested_window():
    out = json.loads(get_metrics.invoke({"service": "checkout-service", "window": "1h"}))
    assert out["window"] == "1h"
    assert out["cpu_pct"] == 91


def test_search_logs_filters_by_query():
    out = json.loads(search_logs.invoke({"service": "checkout-service", "query": "timeout"}))
    assert len(out) == 1
    assert "timeout" in out[0].lower()


def test_search_logs_empty_query_returns_all_lines():
    out = json.loads(search_logs.invoke({"service": "search-index", "query": ""}))
    assert len(out) == 2


def test_list_incidents_returns_open_incidents():
    out = json.loads(list_incidents.invoke({}))
    assert len(out) == 2
    assert {i["service"] for i in out} == {"checkout-service", "search-index"}


def test_restart_service_tool_mutates_store():
    out = json.loads(restart_service.invoke({"service": "search-index"}))
    assert out["status"] == "healthy"


def test_scale_service_tool_mutates_store():
    out = json.loads(scale_service.invoke({"service": "auth-service", "replicas": 7}))
    assert out["replicas"] == 7


def test_rollback_deploy_tool_mutates_store():
    out = json.loads(rollback_deploy.invoke({"service": "checkout-service", "version": "1.8.0"}))
    assert out["version"] == "1.8.0"


def test_risky_tools_are_exactly_the_mutating_ones():
    assert RISKY_TOOL_NAMES == {"restart_service", "scale_service", "rollback_deploy"}


def test_tools_by_name_covers_every_tool():
    assert set(TOOLS_BY_NAME) == {t.name for t in TOOLS}
    assert len(TOOLS) == 8
