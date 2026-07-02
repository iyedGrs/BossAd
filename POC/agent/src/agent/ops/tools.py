"""Tools for the Ops Desk POC agent. Read tools and the `think` narration
tool are side-effect free; the three risky tools mutate agent.ops.store and
are only ever invoked by ops_graph.py after a human approves an interrupt().
No network calls, no real infra."""
import json

from langchain_core.tools import tool

from agent.ops import store

_MOCK_LOGS: dict[str, list[str]] = {
    "checkout-service": [
        "WARN  connection pool exhausted (max=20)",
        "ERROR upstream payments-worker timeout after 3000ms",
        "WARN  gc pause 640ms",
    ],
    "search-index": [
        "ERROR index shard 2/4 unreachable",
        "FATAL process exited with code 137 (OOM)",
    ],
}

_MOCK_METRICS: dict[str, dict] = {
    "api-gateway": {"cpu_pct": 34, "mem_pct": 41, "p99_latency_ms": 120, "rps": 1200},
    "checkout-service": {"cpu_pct": 91, "mem_pct": 88, "p99_latency_ms": 2400, "rps": 340},
    "payments-worker": {"cpu_pct": 22, "mem_pct": 30, "p99_latency_ms": 80, "rps": 210},
    "auth-service": {"cpu_pct": 18, "mem_pct": 25, "p99_latency_ms": 60, "rps": 500},
    "search-index": {"cpu_pct": 0, "mem_pct": 0, "p99_latency_ms": 0, "rps": 0},
}

_INCIDENTS: list[dict] = [
    {"id": "INC-401", "service": "checkout-service",
     "summary": "Elevated error rate since 09:14 UTC", "severity": "high"},
    {"id": "INC-402", "service": "search-index",
     "summary": "Index unreachable, all queries failing", "severity": "critical"},
]


@tool
def think(thought: str) -> str:
    """Narrate your reasoning in ONE short sentence before your next action.
    Call this before every other tool call — it's your visible train of
    thought, not shown to the user as an answer."""
    return "noted"


@tool
def get_service_status(service: str) -> str:
    """Get current status, replica count, version, uptime and error rate for
    one service. Returns JSON."""
    s = store.get(service)
    return json.dumps(s or {"error": f"unknown service '{service}'"})


@tool
def get_metrics(service: str, window: str = "15m") -> str:
    """Get recent CPU/memory/latency/throughput metrics for a service over
    `window` (e.g. "15m"). Returns JSON."""
    m = _MOCK_METRICS.get(service)
    if m is None:
        return json.dumps({"error": f"unknown service '{service}'"})
    return json.dumps({"service": service, "window": window, **m})


@tool
def search_logs(service: str, query: str) -> str:
    """Search recent logs for a service. `query` matches substrings (case
    insensitive); pass "" for the last few lines. Returns a JSON list of
    matching lines."""
    lines = _MOCK_LOGS.get(service, [])
    q = query.strip().lower()
    matched = [line for line in lines if q in line.lower()] if q else lines
    return json.dumps(matched)


@tool
def list_incidents() -> str:
    """List currently open incidents across the fleet. Returns JSON."""
    return json.dumps(_INCIDENTS)


@tool
def restart_service(service: str) -> str:
    """Restart a service, clearing its error state. RISKY: the graph
    intercepts this call and requires human approval before it runs."""
    return json.dumps(store.restart(service))


@tool
def scale_service(service: str, replicas: int) -> str:
    """Change a service's replica count. RISKY: the graph intercepts this
    call and requires human approval before it runs."""
    return json.dumps(store.scale(service, replicas))


@tool
def rollback_deploy(service: str, version: str) -> str:
    """Roll a service back to a prior version. RISKY: the graph intercepts
    this call and requires human approval before it runs."""
    return json.dumps(store.rollback(service, version))


TOOLS = [
    think, get_service_status, get_metrics, search_logs, list_incidents,
    restart_service, scale_service, rollback_deploy,
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}
RISKY_TOOL_NAMES = {"restart_service", "scale_service", "rollback_deploy"}
