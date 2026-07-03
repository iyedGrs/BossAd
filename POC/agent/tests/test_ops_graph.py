from langchain_core.messages import AIMessage
from langgraph.graph import END

from agent.ops import store
from agent.ops.ops_graph import preview_for, route_from_agent


def test_preview_for_restart_service():
    store.reset()
    text = preview_for("restart_service", {"service": "search-index"})
    assert "search-index" in text
    assert "healthy" in text


def test_preview_for_scale_service_shows_before_and_after():
    store.reset()
    text = preview_for("scale_service", {"service": "api-gateway", "replicas": 6})
    assert "3" in text  # current replica count from services.json
    assert "6" in text


def test_preview_for_rollback_deploy_shows_versions():
    store.reset()
    text = preview_for("rollback_deploy", {"service": "checkout-service", "version": "1.8.0"})
    assert "1.9.3" in text  # current version from services.json
    assert "1.8.0" in text


def test_route_from_agent_routes_to_tools_when_tool_calls_present():
    state = {"messages": [AIMessage(content="", tool_calls=[
        {"name": "think", "args": {"thought": "x"}, "id": "call_1"},
    ])]}
    assert route_from_agent(state) == "tools"


def test_route_from_agent_routes_to_end_when_no_tool_calls():
    state = {"messages": [AIMessage(content="all done")]}
    assert route_from_agent(state) == END
