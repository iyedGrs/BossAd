# Ops Desk Showcase Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second page to the POC web app — "Ops Desk" — that showcases a hand-rolled (non-`create_react_agent`) LangGraph agent with a live "thinking" stream, human-in-the-loop approval of risky actions, live skill badges, and checkpoint-based time-travel, chatting about a mock infra fleet.

**Architecture:** New Aegra graph `ops_agent` (`POC/agent/src/agent/ops/`) built as a hand-rolled `agent ⇄ tools` `StateGraph`: the `tools` node executes tool calls one at a time, calling `interrupt()` before any risky mutation and emitting a fleet snapshot as a custom event after every call. New React page (`POC/web/src/pages/OpsDeskPage.tsx`) wired to that graph via `useStream`, reached through a new `react-router-dom` route; existing Ad Insight page becomes `pages/AdInsightPage.tsx` unchanged in behavior. Both pages share a new `TopBar` component (nav + status + theme toggle) and a generalized `ThreadSidebar` (now filtered per-assistant via thread metadata).

**Tech Stack:** Same as the existing POC — Python 3.12+, LangGraph, `langchain-openai` (`ChatOpenAI` against Azure's v1 surface), Aegra, Postgres (via Aegra), React 19 + Vite + TypeScript + Tailwind v4, `@langchain/langgraph-sdk/react`. New dependency: `react-router-dom`.

## Global Constraints

- No `create_react_agent` / LangChain prebuilt agent helpers for the ops graph — hand-rolled `StateGraph` nodes only (spec requirement).
- Tool calls execute one at a time inside the `tools` node (never LangGraph's parallel `ToolNode`), so ordering and interrupts stay predictable.
- Reuse the existing console/dossier visual language (Space Grotesk + JetBrains Mono, existing CSS color tokens `--color-scout` / `--color-writer` / `--color-analyst` / `--color-accent` / `--color-ok` / `--color-bad`) — no new CSS tokens.
- No new frontend test framework — this repo has none today (verification is `tsc -b` / `npm run build` + manual dev-server check), matching existing convention.
- Python tests follow the existing convention: pure/importable logic gets `tests/test_*.py` coverage; async node functions that call the live model are exercised only by the smoke script, not pytest (mirrors `graph.py`'s existing nodes, which have no unit tests).
- Mock ops fleet state is a single process-wide in-memory store (no per-thread isolation) — intentional for a POC demo, not a bug.

---

### Task 1: Extract shared Azure model client

**Files:**
- Create: `POC/agent/src/agent/model.py`
- Modify: `POC/agent/src/agent/graph.py:1-32` (remove inline model construction, import from `agent.model` instead)

**Interfaces:**
- Produces: `agent.model.model` — a configured `ChatOpenAI` instance (Azure v1 surface), importable by both `agent.graph` and the new `agent.ops.ops_graph`.

This is a pure refactor (env validation + `ChatOpenAI` construction, currently the top of `graph.py`, is needed by a second graph now) — no behavior change, so it's verified by re-running the existing suite rather than a new test.

- [ ] **Step 1: Create `agent/model.py` with the extracted model client**

```python
"""Shared Azure OpenAI chat model client for both POC graphs."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[2] / ".env")

_REQUIRED = ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]
_missing = [k for k in _REQUIRED if not os.environ.get(k)]
if _missing:
    raise RuntimeError(
        f"Missing env vars: {', '.join(_missing)}. "
        "Copy POC/agent/.env.example to POC/agent/.env and fill them in."
    )

from langchain_openai import ChatOpenAI

# Azure AI Foundry resources expose the OpenAI-compatible *v1* surface
# (<endpoint>/openai/v1/) instead of the legacy ?api-version= deployments
# route, so we use ChatOpenAI with a base_url; `model` is the deployment name.
_V1_BASE_URL = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/") + "/openai/v1/"

model = ChatOpenAI(
    base_url=_V1_BASE_URL,
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
    streaming=True,
)
```

- [ ] **Step 2: Rewrite `agent/graph.py` to import the shared client**

Replace the file's contents with (identical behavior — only the model-construction block at the top is replaced by an import):

```python
"""BossAd POC graph — served by Aegra as assistant id `agent`."""
import json

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import create_react_agent

from agent.extract import extract_tool_json
from agent.model import model
from agent.prompts import ANALYST_PROMPT, SCOUT_PROMPT, WRITER_PROMPT
from agent.router import decide_next
from agent.state import AgentState
from agent.tools import compare_products, search_ads

_scout_agent = create_react_agent(model, tools=[search_ads], prompt=SCOUT_PROMPT)
_analyst_agent = create_react_agent(model, tools=[compare_products], prompt=ANALYST_PROMPT)

_PHASE_LABELS = {
    "market_scout": "Handing off to Market Scout…",
    "scoring_analyst": "Handing off to Scoring Analyst…",
    "report_writer": "Handing off to Report Writer…",
}


async def supervisor_node(state: AgentState) -> dict:
    next_phase = decide_next(state)
    if next_phase == "end":
        return {}
    writer = get_stream_writer()
    writer({"phase": next_phase, "status": "start", "label": _PHASE_LABELS[next_phase]})
    return {"messages": [AIMessage(content=_PHASE_LABELS[next_phase])]}


def route_from_supervisor(state: AgentState) -> str:
    return decide_next(state) if decide_next(state) != "end" else END


async def market_scout_node(state: AgentState) -> dict:
    result = await _scout_agent.ainvoke({"messages": state["messages"]})
    new_messages = result["messages"][len(state["messages"]):]
    search_results = extract_tool_json(new_messages, "search_ads") or []
    writer = get_stream_writer()
    writer({"phase": "market_scout", "status": "done",
             "label": f"Found {len(search_results)} candidate ads"})
    return {"messages": new_messages, "search_results": search_results}


async def scoring_analyst_node(state: AgentState) -> dict:
    result = await _analyst_agent.ainvoke({"messages": state["messages"]})
    new_messages = result["messages"][len(state["messages"]):]
    scores = extract_tool_json(new_messages, "compare_products") or []
    writer = get_stream_writer()
    writer({"phase": "scoring_analyst", "status": "done",
             "label": f"Scored {len(scores)} products"})
    return {"messages": new_messages, "scores": scores}


async def report_writer_node(state: AgentState) -> dict:
    response = await model.ainvoke(
        [{"role": "system", "content": WRITER_PROMPT}, *state["messages"]]
    )
    writer = get_stream_writer()
    writer({"phase": "report_writer", "status": "done", "label": "Report complete"})
    return {"messages": [response], "report_done": True}


_builder = StateGraph(AgentState)
_builder.add_node("supervisor", supervisor_node)
_builder.add_node("market_scout", market_scout_node)
_builder.add_node("scoring_analyst", scoring_analyst_node)
_builder.add_node("report_writer", report_writer_node)
_builder.add_edge(START, "supervisor")
_builder.add_conditional_edges("supervisor", route_from_supervisor, {
    "market_scout": "market_scout",
    "scoring_analyst": "scoring_analyst",
    "report_writer": "report_writer",
    END: END,
})
_builder.add_edge("market_scout", "supervisor")
_builder.add_edge("scoring_analyst", "supervisor")
_builder.add_edge("report_writer", "supervisor")

graph = _builder.compile()
```

- [ ] **Step 3: Verify the refactor didn't break anything**

Run: `cd POC/agent && uv run pytest tests/ -v`
Expected: all 13 existing tests still pass (they don't touch `graph.py`/`model.py` directly, but this confirms nothing else broke on import).

Then confirm the module still imports cleanly:
Run: `cd POC/agent && uv run python -c "import agent.graph; print('ok')"`
Expected: prints `ok` (requires `.env` filled in with real Azure credentials — if you don't have them handy, skip this specific check and rely on Task 5's smoke test later).

- [ ] **Step 4: Commit**

```bash
git add POC/agent/src/agent/model.py POC/agent/src/agent/graph.py
git commit -m "refactor: extract shared Azure model client into agent.model"
```

---

### Task 2: Mock ops fleet + store

**Files:**
- Create: `POC/agent/src/agent/ops/__init__.py` (empty)
- Create: `POC/agent/src/agent/ops/data/services.json`
- Create: `POC/agent/src/agent/ops/store.py`
- Test: `POC/agent/tests/test_ops_store.py`

**Interfaces:**
- Produces: `agent.ops.store.snapshot() -> list[dict]`, `get(name: str) -> dict | None`, `restart(name) -> dict`, `scale(name, replicas) -> dict`, `rollback(name, version) -> dict`, `reset() -> None` (test-only, reloads from disk).

- [ ] **Step 1: Create the mock fleet data file**

`POC/agent/src/agent/ops/data/services.json`:

```json
[
  {"name": "api-gateway", "status": "healthy", "replicas": 3, "version": "2.14.0", "uptime_pct": 99.95, "error_rate_pct": 0.2},
  {"name": "checkout-service", "status": "degraded", "replicas": 2, "version": "1.9.3", "uptime_pct": 98.1, "error_rate_pct": 4.8},
  {"name": "payments-worker", "status": "healthy", "replicas": 4, "version": "3.2.1", "uptime_pct": 99.99, "error_rate_pct": 0.05},
  {"name": "auth-service", "status": "healthy", "replicas": 2, "version": "1.4.0", "uptime_pct": 99.8, "error_rate_pct": 0.3},
  {"name": "search-index", "status": "down", "replicas": 0, "version": "0.9.7", "uptime_pct": 82.0, "error_rate_pct": 100.0}
]
```

- [ ] **Step 2: Create empty package init**

`POC/agent/src/agent/ops/__init__.py`: empty file.

- [ ] **Step 3: Write the failing test**

`POC/agent/tests/test_ops_store.py`:

```python
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd POC/agent && uv run pytest tests/test_ops_store.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'agent.ops.store'`.

- [ ] **Step 5: Implement `store.py`**

`POC/agent/src/agent/ops/store.py`:

```python
"""In-memory mock ops fleet — shared process-wide store, no persistence.
Resets on server restart; intentional for a POC (every thread shares one
fleet — a demo of a live shared system, not per-conversation state)."""
import json
from pathlib import Path
from threading import Lock

_DATA_PATH = Path(__file__).parent / "data" / "services.json"
_lock = Lock()


def _load() -> dict[str, dict]:
    return {s["name"]: s for s in json.loads(_DATA_PATH.read_text(encoding="utf-8"))}


_services: dict[str, dict] = _load()


def reset() -> None:
    """Reload the fleet from disk, discarding in-memory mutations. Test-only."""
    with _lock:
        _services.clear()
        _services.update(_load())


def snapshot() -> list[dict]:
    """All services, current state."""
    with _lock:
        return [dict(s) for s in _services.values()]


def get(name: str) -> dict | None:
    with _lock:
        s = _services.get(name)
        return dict(s) if s else None


def restart(name: str) -> dict:
    """Clear a service's error state and bring it back to healthy."""
    with _lock:
        s = _services[name]
        s["status"] = "healthy"
        s["error_rate_pct"] = 0.1
        s["uptime_pct"] = 100.0
        if s["replicas"] == 0:
            s["replicas"] = 1
        return dict(s)


def scale(name: str, replicas: int) -> dict:
    with _lock:
        s = _services[name]
        s["replicas"] = replicas
        return dict(s)


def rollback(name: str, version: str) -> dict:
    with _lock:
        s = _services[name]
        s["version"] = version
        s["status"] = "healthy"
        return dict(s)
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd POC/agent && uv run pytest tests/test_ops_store.py -v`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add POC/agent/src/agent/ops/__init__.py POC/agent/src/agent/ops/data/services.json POC/agent/src/agent/ops/store.py POC/agent/tests/test_ops_store.py
git commit -m "feat: add mock ops fleet store for the Ops Desk graph"
```

---

### Task 3: Ops tools + system prompt

**Files:**
- Create: `POC/agent/src/agent/ops/tools.py`
- Create: `POC/agent/src/agent/ops/prompts.py`
- Test: `POC/agent/tests/test_ops_tools.py`

**Interfaces:**
- Consumes: `agent.ops.store.get/restart/scale/rollback/snapshot` (Task 2).
- Produces: `agent.ops.tools.TOOLS` (list of 8 `@tool`-wrapped callables), `TOOLS_BY_NAME` (dict name→tool), `RISKY_TOOL_NAMES` (`{"restart_service", "scale_service", "rollback_deploy"}`), `agent.ops.prompts.OPS_PROMPT` (str).

- [ ] **Step 1: Write the failing test**

`POC/agent/tests/test_ops_tools.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd POC/agent && uv run pytest tests/test_ops_tools.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'agent.ops.tools'`.

- [ ] **Step 3: Implement `tools.py`**

`POC/agent/src/agent/ops/tools.py`:

```python
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
```

- [ ] **Step 4: Create the system prompt**

`POC/agent/src/agent/ops/prompts.py`:

```python
OPS_PROMPT = """You are the on-call Ops Assistant for a small service fleet (proof-of-concept demo).

Before every other tool call, call `think` with ONE short sentence of reasoning — \
what you're about to check or do and why. This is your visible train of thought.

Investigate with the read tools (`get_service_status`, `get_metrics`, `search_logs`, \
`list_incidents`) before proposing any change. Only call `restart_service`, \
`scale_service`, or `rollback_deploy` once you have evidence from the read tools \
that the action is warranted. These three are RISKY — a human must approve each \
one before it takes effect, and may deny it. If an action is denied, acknowledge \
the denial in your next `think` call and either suggest an alternative or stop.

Never invent service data, metrics, or log lines — only report what the tools \
return. When you're done, write ONE short plain-text summary of what you found \
and did (no heading, no markdown)."""
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd POC/agent && uv run pytest tests/test_ops_tools.py -v`
Expected: 12 passed.

- [ ] **Step 6: Commit**

```bash
git add POC/agent/src/agent/ops/tools.py POC/agent/src/agent/ops/prompts.py POC/agent/tests/test_ops_tools.py
git commit -m "feat: add Ops Desk tools (think + reads + risky actions) and system prompt"
```

---

### Task 4: Ops graph — hand-rolled loop with HITL interrupt

**Files:**
- Create: `POC/agent/src/agent/ops/state.py`
- Create: `POC/agent/src/agent/ops/ops_graph.py`
- Test: `POC/agent/tests/test_ops_graph.py`
- Modify: `POC/agent/aegra.json` (register the new graph)

**Interfaces:**
- Consumes: `agent.model.model` (Task 1), `agent.ops.store` (Task 2), `agent.ops.tools.{TOOLS, TOOLS_BY_NAME, RISKY_TOOL_NAMES}` + `agent.ops.prompts.OPS_PROMPT` (Task 3).
- Produces: `agent.ops.ops_graph.graph` (compiled `StateGraph`, exported for Aegra), `preview_for(name: str, args: dict) -> str` (pure helper, tested directly), `route_from_agent(state) -> str` (pure helper, tested directly).

- [ ] **Step 1: Create the graph state**

`POC/agent/src/agent/ops/state.py`:

```python
"""Graph state for the Ops Desk agent."""
from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class OpsState(TypedDict):
    messages: Annotated[list, add_messages]
```

- [ ] **Step 2: Write the failing test for the pure helpers**

`POC/agent/tests/test_ops_graph.py`:

```python
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd POC/agent && uv run pytest tests/test_ops_graph.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'agent.ops.ops_graph'`.

- [ ] **Step 4: Implement the graph**

`POC/agent/src/agent/ops/ops_graph.py`:

```python
"""Ops Desk POC graph — served by Aegra as assistant id `ops_agent`.

Hand-rolled tool-calling loop (no create_react_agent) so we control exactly
when each tool call streams and where the human-approval interrupt lands."""
import json

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from agent.model import model
from agent.ops import store
from agent.ops.prompts import OPS_PROMPT
from agent.ops.state import OpsState
from agent.ops.tools import RISKY_TOOL_NAMES, TOOLS, TOOLS_BY_NAME

_model_with_tools = model.bind_tools(TOOLS)


def preview_for(name: str, args: dict) -> str:
    """One-line before/after description shown on the approval card."""
    service = args.get("service", "?")
    current = store.get(service) or {}
    if name == "restart_service":
        return f"{service}: status {current.get('status', '?')} → healthy"
    if name == "scale_service":
        return f"{service}: replicas {current.get('replicas', '?')} → {args.get('replicas', '?')}"
    if name == "rollback_deploy":
        return f"{service}: version {current.get('version', '?')} → {args.get('version', '?')}"
    return f"{service}: {args}"


async def agent_node(state: OpsState) -> dict:
    response = await _model_with_tools.ainvoke(
        [{"role": "system", "content": OPS_PROMPT}, *state["messages"]]
    )
    return {"messages": [response]}


def route_from_agent(state: OpsState) -> str:
    last: AIMessage = state["messages"][-1]
    return "tools" if getattr(last, "tool_calls", None) else END


async def tools_node(state: OpsState) -> dict:
    last: AIMessage = state["messages"][-1]
    writer = get_stream_writer()
    new_messages: list[ToolMessage] = []

    for tc in last.tool_calls:
        name, args, call_id = tc["name"], tc["args"], tc["id"]

        if name in RISKY_TOOL_NAMES:
            decision = interrupt({
                "action": name,
                "service": args.get("service"),
                "args": args,
                "preview": preview_for(name, args),
            })
            if decision.get("decision") == "approve":
                result = TOOLS_BY_NAME[name].invoke(args)
            else:
                result = json.dumps({
                    "denied": True,
                    "reason": decision.get("reason", "no reason given"),
                })
        else:
            result = TOOLS_BY_NAME[name].invoke(args)

        new_messages.append(ToolMessage(content=result, tool_call_id=call_id, name=name))
        writer({"type": "board", "services": store.snapshot()})

    return {"messages": new_messages}


_builder = StateGraph(OpsState)
_builder.add_node("agent", agent_node)
_builder.add_node("tools", tools_node)
_builder.add_edge(START, "agent")
_builder.add_conditional_edges("agent", route_from_agent, {"tools": "tools", END: END})
_builder.add_edge("tools", "agent")

graph = _builder.compile()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd POC/agent && uv run pytest tests/test_ops_graph.py -v`
Expected: 5 passed.

- [ ] **Step 6: Register the graph with Aegra**

`POC/agent/aegra.json` — add the `ops_agent` entry:

```json
{
  "graphs": {
    "agent": "./src/agent/graph.py:graph",
    "ops_agent": "./src/agent/ops/ops_graph.py:graph"
  },
  "dependencies": ["./src"],
  "http": {
    "cors": {
      "allow_origins": ["http://localhost:5173", "https://boss-ad.vercel.app"],
      "allow_credentials": true
    }
  }
}
```

- [ ] **Step 7: Run the full backend test suite**

Run: `cd POC/agent && uv run pytest tests/ -v`
Expected: 36 passed (13 original + 6 store + 12 tools + 5 graph).

- [ ] **Step 8: Commit**

```bash
git add POC/agent/src/agent/ops/state.py POC/agent/src/agent/ops/ops_graph.py POC/agent/tests/test_ops_graph.py POC/agent/aegra.json
git commit -m "feat: add hand-rolled Ops Desk graph with HITL interrupt on risky actions"
```

---

### Task 5: End-to-end smoke test

**Files:**
- Create: `POC/scripts/smoke_ops.py`

**Interfaces:**
- Consumes: the running `ops_agent` graph served by Aegra at `http://localhost:2024` (Task 4).

This mirrors `POC/scripts/smoke.py`'s style: a standalone async script, not part of the pytest suite, run manually against a live Aegra server. It proves the interrupt/resume round-trip actually works end-to-end (not just the pure helpers tested in Task 4).

- [ ] **Step 1: Write the smoke script**

`POC/scripts/smoke_ops.py`:

```python
"""End-to-end smoke test for the Ops Desk graph: drives a run into a risky
tool call, asserts it interrupts, then resumes once with approve (asserts
the action actually ran) and once with deny (asserts it didn't), each on
its own thread.
Run from POC/agent:  uv run python ../scripts/smoke_ops.py
Exit 0 on success, 1 on failure.
"""
import asyncio
import json
import sys

from langgraph_sdk import get_client

ASSISTANT_ID = "ops_agent"
ASK = ("checkout-service is showing a high error rate — investigate and "
       "restart it if that's warranted.")


async def _run_until_interrupt(client, thread_id: str) -> dict | None:
    interrupt_value = None
    async for chunk in client.runs.stream(
        thread_id=thread_id,
        assistant_id=ASSISTANT_ID,
        input={"messages": [{"type": "human", "content": ASK}]},
        stream_mode=["updates"],
    ):
        if chunk.event == "updates" and isinstance(chunk.data, dict) and "__interrupt__" in chunk.data:
            raw = chunk.data["__interrupt__"]
            interrupt_value = raw[0]["value"] if isinstance(raw, list) else raw["value"]
    return interrupt_value


async def _resume(client, thread_id: str, resume_value: dict) -> None:
    async for _ in client.runs.stream(
        thread_id=thread_id,
        assistant_id=ASSISTANT_ID,
        command={"resume": resume_value},
        stream_mode=["updates"],
    ):
        pass


async def _last_tool_result(client, thread_id: str, tool_name: str) -> dict | None:
    state = await client.threads.get_state(thread_id)
    for m in reversed(state["values"].get("messages", [])):
        if m.get("type") == "tool" and m.get("name") == tool_name:
            return json.loads(m["content"])
    return None


async def main() -> int:
    client = get_client(url="http://localhost:2024")

    # --- approve path ---
    approve_thread = await client.threads.create()
    approve_interrupt = await _run_until_interrupt(client, approve_thread["thread_id"])
    ok_interrupt = bool(approve_interrupt) and approve_interrupt.get("action") == "restart_service"
    await _resume(client, approve_thread["thread_id"], {"decision": "approve"})
    approve_result = await _last_tool_result(client, approve_thread["thread_id"], "restart_service")
    ok_approved = bool(approve_result) and approve_result.get("status") == "healthy"

    print(f"interrupted with action restart_service: {ok_interrupt}")
    print(f"approve path: action actually ran (status=healthy): {ok_approved}")

    # --- deny path ---
    deny_thread = await client.threads.create()
    deny_interrupt = await _run_until_interrupt(client, deny_thread["thread_id"])
    ok_interrupt_2 = bool(deny_interrupt)
    await _resume(client, deny_thread["thread_id"], {"decision": "deny", "reason": "smoke test denial"})
    deny_result = await _last_tool_result(client, deny_thread["thread_id"], "restart_service")
    ok_denied = bool(deny_result) and deny_result.get("denied") is True

    print(f"second run also interrupted: {ok_interrupt_2}")
    print(f"deny path: action recorded as denied, not run: {ok_denied}")

    return 0 if (ok_interrupt and ok_approved and ok_interrupt_2 and ok_denied) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: Run it against a live Aegra server**

Start the agent server if it isn't already running: `cd POC/agent && uv run aegra dev --port 2024`

In a second terminal:
Run: `cd POC/agent && uv run python ../scripts/smoke_ops.py`
Expected: exit code 0, all four printed lines read `True`.

- [ ] **Step 3: Commit**

```bash
git add POC/scripts/smoke_ops.py
git commit -m "test: add end-to-end smoke script for Ops Desk HITL approve/deny paths"
```

---

### Task 6: Router shell, shared TopBar, move Ad Insight page

**Files:**
- Modify: `POC/web/package.json` (add `react-router-dom`)
- Create: `POC/web/src/components/TopBar.tsx`
- Create: `POC/web/src/pages/AdInsightPage.tsx`
- Modify: `POC/web/src/App.tsx` (becomes a router shell)

**Interfaces:**
- Produces: `TopBar` component (`{title, subtitle, status, theme, onToggleTheme, onNewThread}` props), `AdInsightPage` component (`{theme, onToggleTheme}` props, default export).

This is a pure structural move — `AdInsightPage` must behave identically to today's `App.tsx` (same layout, same `useStream` config, same thread reattach behavior). Verified by TypeScript build + manual check, matching this repo's existing (test-framework-free) frontend convention.

- [ ] **Step 1: Add the router dependency**

Run: `cd POC/web && npm install react-router-dom`
Expected: `package.json`/`package-lock.json` updated, install succeeds.

- [ ] **Step 2: Create the shared top bar**

`POC/web/src/components/TopBar.tsx`:

```tsx
import { NavLink } from "react-router-dom";
import type { Theme } from "../lib/theme";

const NAV_LINKS = [
  { to: "/", label: "Ad Insight" },
  { to: "/ops", label: "Ops Desk" },
];

export function TopBar(props: {
  title: string;
  subtitle: string;
  status: "idle" | "running" | "error";
  theme: Theme;
  onToggleTheme: () => void;
  onNewThread: () => void;
}) {
  return (
    <header className="border-b border-line px-6 py-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            BOSSAD<span className="text-accent">//</span>
            <span className="text-muted">{props.title}</span>
          </h1>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted/60 sm:inline">
            {props.subtitle}
          </span>
          <nav className="ml-2 flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                    isActive ? "bg-surface text-accent" : "text-muted hover:text-ink"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted">
            <span className={`inline-block size-1.5 rounded-full transition-colors ${
              props.status === "running" ? "pulse led-live bg-accent text-accent" : props.status === "error" ? "bg-bad" : "bg-ok"
            }`} />
            <span className="font-semibold">{props.status}</span>
          </div>
          <button
            onClick={props.onNewThread}
            className="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            New thread
          </button>
          <button
            onClick={props.onToggleTheme}
            className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted transition-colors hover:border-accent/50 hover:text-accent"
          >
            {props.theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Move the Ad Insight page content**

`POC/web/src/pages/AdInsightPage.tsx` (adapted from today's `App.tsx`: header replaced with `TopBar`, `assistantId`/`apiUrl` hoisted to constants, theme lifted to props):

```tsx
import { useEffect, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { RunComposer } from "../components/RunComposer";
import { AgentTimeline } from "../components/AgentTimeline";
import { LiveReport } from "../components/LiveReport";
import { ThreadSidebar } from "../components/ThreadSidebar";
import { TopBar } from "../components/TopBar";
import { deriveReport, deriveTimeline, mergeTimeline, type PhaseEvent } from "../lib/messages";
import { tagThread } from "../lib/tagThread";
import type { Theme } from "../lib/theme";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:2024";
const ASSISTANT_ID = "agent";

export default function AdInsightPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(
    () => sessionStorage.getItem("poc-thread"),
  );
  const [prefill, setPrefill] = useState("");
  const [threadListTick, setThreadListTick] = useState(0);
  const [phases, setPhases] = useState<PhaseEvent[]>([]);

  const stream = useStream({
    apiUrl: API_URL,
    assistantId: ASSISTANT_ID,
    messagesKey: "messages",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      if (id) {
        sessionStorage.setItem("poc-thread", id);
        tagThread(API_URL, id, ASSISTANT_ID);
      }
    },
    onCustomEvent: (event) => {
      setPhases((prev) => [...prev, event as PhaseEvent]);
    },
    reconnectOnMount: true,
  });

  useEffect(() => {
    if (!stream.isLoading) setThreadListTick((n) => n + 1);
  }, [stream.isLoading]);

  const timeline = mergeTimeline(deriveTimeline(stream.messages), phases);
  const report = deriveReport(stream.messages);
  const status = stream.error ? "error" : stream.isLoading ? "running" : "idle";

  function resetThread() {
    sessionStorage.removeItem("poc-thread");
    setThreadId(null);
    setPhases([]);
  }

  return (
    <>
      <TopBar
        title="SIGNAL DESK"
        subtitle="ad-intel console"
        status={status}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onNewThread={resetThread}
      />
      {stream.error != null && (
        <div className="border-b border-bad/30 bg-bad/5 px-6 py-3 font-mono text-xs text-bad">
          <span className="font-semibold">ERROR //</span> {String((stream.error as Error).message ?? stream.error)} — is Aegra running on :2024?
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ThreadSidebar
          apiUrl={API_URL}
          assistantId={ASSISTANT_ID}
          activeThreadId={threadId}
          refreshKey={threadListTick}
          onSelect={(id) => {
            setThreadId(id);
            sessionStorage.setItem("poc-thread", id);
            setPhases([]);
          }}
          onNew={resetThread}
        />
        <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-line">
          <RunComposer
            isLoading={stream.isLoading}
            onStop={() => stream.stop()}
            onSubmit={(q) => stream.submit({ messages: [{ type: "human", content: q }] })}
            prefill={prefill}
            setPrefill={setPrefill}
          />
          <AgentTimeline entries={timeline} />
        </aside>
        <section className="min-w-0 flex-1">
          <LiveReport markdown={report} isLoading={stream.isLoading} />
        </section>
      </div>
    </>
  );
}
```

Note: this references `ThreadSidebar`'s new `assistantId` prop and `../lib/tagThread` — both created in Task 7. This task and Task 7 are sequenced so Task 7 lands first if implementing strictly in order; if implementing task-by-task with review gates, it's fine for this file to reference them since Task 7 follows immediately next.

- [ ] **Step 4: Rewrite `App.tsx` as the router shell**

`POC/web/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import AdInsightPage from "./pages/AdInsightPage";
import OpsDeskPage from "./pages/OpsDeskPage";
import { applyTheme, getStoredTheme, type Theme } from "./lib/theme";

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <BrowserRouter>
      <div className="flex h-screen flex-col">
        <Routes>
          <Route path="/" element={<AdInsightPage theme={theme} onToggleTheme={toggleTheme} />} />
          <Route path="/ops" element={<OpsDeskPage theme={theme} onToggleTheme={toggleTheme} />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
```

This references `./pages/OpsDeskPage`, created in Task 11 — the build won't type-check until that file exists. That's expected; this task's own verification step (below) only checks that the pieces built so far are consistent, via a targeted type-check that tolerates the not-yet-created page. If running tasks strictly in order without stopping to verify a full build between Tasks 6–10, defer the full `npm run build` check to Task 11's verification step, which exercises the complete app.

- [ ] **Step 5: Commit**

```bash
git add POC/web/package.json POC/web/package-lock.json POC/web/src/components/TopBar.tsx POC/web/src/pages/AdInsightPage.tsx POC/web/src/App.tsx
git commit -m "feat: add router shell and shared TopBar; move Ad Insight page content"
```

---

### Task 7: Generalize ThreadSidebar per-assistant + thread tagging helper

**Files:**
- Modify: `POC/web/src/components/ThreadSidebar.tsx`
- Create: `POC/web/src/lib/tagThread.ts`

**Interfaces:**
- Produces: `ThreadSidebar` now requires an `assistantId: string` prop and filters `threads.search` by `metadata: { graph_id: assistantId }`. `tagThread(apiUrl, threadId, assistantId)` — fire-and-forget metadata tag, called from each page's `onThreadId`.

Threads created before this change have no `graph_id` metadata and will no longer appear in the (now-filtered) Ad Insight sidebar — acceptable for this local-dev POC; call this out in Task 12's README update.

- [ ] **Step 1: Add the tagging helper**

`POC/web/src/lib/tagThread.ts`:

```ts
import { Client } from "@langchain/langgraph-sdk";

/** Tags a newly created thread with which graph owns it, so ThreadSidebar
 * can filter its list to just that graph's threads. Fire-and-forget. */
export function tagThread(apiUrl: string, threadId: string, assistantId: string): void {
  new Client({ apiUrl }).threads.update(threadId, { metadata: { graph_id: assistantId } }).catch(() => {});
}
```

- [ ] **Step 2: Modify `ThreadSidebar` to filter by assistant**

In `POC/web/src/components/ThreadSidebar.tsx`, add `assistantId: string;` to the props type and use it in the search filter:

```tsx
export function ThreadSidebar(props: {
  apiUrl: string;
  assistantId: string;
  activeThreadId: string | null;
  refreshKey: number;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
```

And update the `refresh` callback's `client.threads.search` call:

```tsx
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const client = new Client({ apiUrl: props.apiUrl });
      const result = await client.threads.search({
        limit: 50,
        sortBy: "updated_at",
        sortOrder: "desc",
        metadata: { graph_id: props.assistantId },
      });
      setThreads(result);
    } catch {
      // Aegra may be offline — keep the last known list.
    } finally {
      setLoading(false);
    }
  }, [props.apiUrl, props.assistantId]);
```

(Also add `props.assistantId` to the existing `useEffect(() => { refresh(); }, [refresh, props.refreshKey])` dependency array — it already depends on `refresh`, which now changes identity when `assistantId` changes, so no further edit is needed there.)

- [ ] **Step 3: Verify the Ad Insight page (Task 6) now type-checks against this prop**

Run: `cd POC/web && npx tsc -b --noEmit`
Expected: no errors referencing `ThreadSidebar` or `tagThread` (errors about the not-yet-created `OpsDeskPage` import in `App.tsx` are expected at this point and are resolved by Task 11).

- [ ] **Step 4: Commit**

```bash
git add POC/web/src/components/ThreadSidebar.tsx POC/web/src/lib/tagThread.ts
git commit -m "feat: filter ThreadSidebar per-assistant via thread metadata"
```

---

### Task 8: Ops transcript/board derivation library

**Files:**
- Create: `POC/web/src/lib/opsMessages.ts`

**Interfaces:**
- Produces: `OpsSkill` (`"diagnostics" | "scaling" | "recovery"`), `OpsEntry` (discriminated union: `human` | `think` | `tool` | `answer` — `human` carries the raw `Message` + its index, needed later for edit/branch operations), `deriveOpsTranscript(messages: Message[]): OpsEntry[]`, `OpsService` type, `OpsBoardEvent` type, `BranchInfo` type (used by Task 10's branch switcher).

- [ ] **Step 1: Create the library**

`POC/web/src/lib/opsMessages.ts`:

```ts
import type { Message } from "@langchain/langgraph-sdk";

export type OpsSkill = "diagnostics" | "scaling" | "recovery";

export type OpsEntry =
  | { id: string; kind: "human"; text: string; message: Message; index: number }
  | { id: string; kind: "think"; text: string; status: "running" | "done" }
  | {
      id: string;
      kind: "tool";
      name: string;
      args: string;
      result?: string;
      status: "running" | "done";
      skill?: OpsSkill;
      denied?: boolean;
    }
  | { id: string; kind: "answer"; text: string };

export type OpsService = {
  name: string;
  status: string;
  replicas: number;
  version: string;
  uptime_pct: number;
  error_rate_pct: number;
};

export type OpsBoardEvent = { type: "board"; services: OpsService[] };

/** Branch info for a message with edit/resubmit siblings — a thin projection
 * of useStream's MessageMetadata so leaf components don't need the full,
 * generically-typed shape. */
export type BranchInfo = { branch?: string; branchOptions?: string[] };

const SKILL_BY_TOOL: Record<string, OpsSkill> = {
  get_service_status: "diagnostics",
  get_metrics: "diagnostics",
  search_logs: "diagnostics",
  list_incidents: "diagnostics",
  scale_service: "scaling",
  restart_service: "recovery",
  rollback_deploy: "recovery",
};

const asText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
      : "";

/** Chat transcript, in order: human turns, `think` asides, other tool calls
 * (revealed one at a time as they stream in), and the final answer. */
export function deriveOpsTranscript(messages: Message[]): OpsEntry[] {
  const resultsByCallId = new Map<string, { content: string; denied: boolean }>();
  for (const m of messages) {
    if (m.type === "tool" && (m as any).tool_call_id) {
      const content = asText(m.content);
      let denied = false;
      try {
        denied = Boolean(JSON.parse(content)?.denied);
      } catch {
        // not JSON — not a denial record
      }
      resultsByCallId.set((m as any).tool_call_id, { content, denied });
    }
  }

  const entries: OpsEntry[] = [];
  messages.forEach((m, index) => {
    if (m.type === "human") {
      entries.push({ id: m.id ?? `h-${index}`, kind: "human", text: asText(m.content), message: m, index });
      return;
    }
    if (m.type !== "ai") return;

    const toolCalls = (m as any).tool_calls ?? [];
    const text = asText(m.content).trim();

    if (toolCalls.length === 0) {
      if (text) entries.push({ id: m.id ?? `a-${index}`, kind: "answer", text });
      return;
    }

    for (const tc of toolCalls) {
      const res = tc.id ? resultsByCallId.get(tc.id) : undefined;
      if (tc.name === "think") {
        entries.push({
          id: tc.id ?? `${m.id}-${tc.name}`,
          kind: "think",
          text: tc.args?.thought ?? "",
          status: res !== undefined ? "done" : "running",
        });
        continue;
      }
      entries.push({
        id: tc.id ?? `${m.id}-${tc.name}`,
        kind: "tool",
        name: tc.name,
        args: JSON.stringify(tc.args),
        result: res?.content,
        status: res !== undefined ? "done" : "running",
        skill: SKILL_BY_TOOL[tc.name],
        denied: res?.denied,
      });
    }
  });
  return entries;
}
```

- [ ] **Step 2: Verify it type-checks in isolation**

Run: `cd POC/web && npx tsc -b --noEmit`
Expected: no new errors introduced by this file (the pre-existing `OpsDeskPage` import error in `App.tsx` is still expected until Task 11).

- [ ] **Step 3: Commit**

```bash
git add POC/web/src/lib/opsMessages.ts
git commit -m "feat: add Ops Desk transcript/board derivation from message stream"
```

---

### Task 9: Skill badge, HITL card, and Ops Board components

**Files:**
- Create: `POC/web/src/components/ops/SkillBadge.tsx`
- Create: `POC/web/src/components/ops/HitlCard.tsx`
- Create: `POC/web/src/components/ops/OpsBoard.tsx`

**Interfaces:**
- Consumes: `OpsSkill`, `OpsService` (Task 8).
- Produces: `SkillBadge({skill})`, `HitlCard({value, onRespond, pending})` + exported `OpsInterruptValue` type, `OpsBoard({services})`.

- [ ] **Step 1: Create the skill badge**

`POC/web/src/components/ops/SkillBadge.tsx`:

```tsx
import type { OpsSkill } from "../../lib/opsMessages";

const SKILL_META: Record<OpsSkill, { label: string; color: string }> = {
  diagnostics: { label: "DIAGNOSTICS", color: "text-scout" },
  scaling: { label: "SCALING", color: "text-writer" },
  recovery: { label: "RECOVERY", color: "text-analyst" },
};

export function SkillBadge({ skill }: { skill?: OpsSkill }) {
  if (!skill) return null;
  const meta = SKILL_META[skill];
  return (
    <span className={`font-mono text-[9px] font-semibold uppercase tracking-wider ${meta.color}`}>
      {meta.label}
    </span>
  );
}
```

- [ ] **Step 2: Create the HITL approval card**

`POC/web/src/components/ops/HitlCard.tsx`:

```tsx
export type OpsInterruptValue = {
  action: string;
  service?: string;
  args: Record<string, unknown>;
  preview: string;
};

const ACTION_LABEL: Record<string, string> = {
  restart_service: "Restart service",
  scale_service: "Scale service",
  rollback_deploy: "Rollback deploy",
};

export function HitlCard(props: {
  value: OpsInterruptValue;
  onRespond: (response: { decision: "approve" | "deny"; reason?: string }) => void;
  pending: boolean;
}) {
  return (
    <div className="my-2 rounded-md border border-accent/50 bg-accent/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="pulse led-live inline-block size-1.5 rounded-full bg-accent text-accent" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-accent">
          Approval required
        </span>
      </div>
      <p className="mb-1 font-display text-sm text-ink">
        {ACTION_LABEL[props.value.action] ?? props.value.action}
        {props.value.service && <span className="text-muted"> · {props.value.service}</span>}
      </p>
      <p className="mb-3 font-mono text-[12.5px] text-muted">{props.value.preview}</p>
      <div className="flex gap-2">
        <button
          disabled={props.pending}
          onClick={() => props.onRespond({ decision: "approve" })}
          className="rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-bg transition-opacity disabled:opacity-40 hover:enabled:opacity-90"
        >
          Approve
        </button>
        <button
          disabled={props.pending}
          onClick={() => props.onRespond({ decision: "deny", reason: "denied by operator" })}
          className="rounded-md border border-bad px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-bad transition-colors disabled:opacity-40 hover:enabled:bg-bad/10"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the live fleet board**

`POC/web/src/components/ops/OpsBoard.tsx`:

```tsx
import type { OpsService } from "../../lib/opsMessages";

const STATUS_COLOR: Record<string, string> = {
  healthy: "bg-ok",
  degraded: "bg-accent",
  down: "bg-bad",
};

export function OpsBoard({ services }: { services: OpsService[] }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-line">
      <div className="border-b border-line px-4 py-4">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted">
          Fleet status
        </span>
      </div>
      {services.length === 0 ? (
        <p className="p-4 font-mono text-[11px] text-muted/70">No signal yet.</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {services.map((s) => (
            <li key={s.name} className="scan-in px-4 py-3">
              <div className="mb-1 flex items-center gap-2">
                <span className={`size-1.5 rounded-full ${STATUS_COLOR[s.status] ?? "bg-muted"}`} />
                <span className="font-mono text-[12px] font-medium text-ink">{s.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 font-mono text-[10.5px] text-muted">
                <span>replicas {s.replicas}</span>
                <span>v{s.version}</span>
                <span>uptime {s.uptime_pct}%</span>
                <span>err {s.error_rate_pct}%</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Verify type-check**

Run: `cd POC/web && npx tsc -b --noEmit`
Expected: no new errors from these three files.

- [ ] **Step 5: Commit**

```bash
git add POC/web/src/components/ops/SkillBadge.tsx POC/web/src/components/ops/HitlCard.tsx POC/web/src/components/ops/OpsBoard.tsx
git commit -m "feat: add SkillBadge, HitlCard, and OpsBoard components"
```

---

### Task 10: Ops transcript + composer (incl. time-travel edit/branch)

**Files:**
- Create: `POC/web/src/components/ops/OpsTranscript.tsx`
- Create: `POC/web/src/components/ops/OpsComposer.tsx`

**Interfaces:**
- Consumes: `OpsEntry`, `BranchInfo` (Task 8), `HitlCard` + `OpsInterruptValue`, `SkillBadge` (Task 9).
- Produces: `OpsTranscript({entries, interruptValue, onRespond, isResponding, getBranchInfo, onEditMessage, onSelectBranch})`, `OpsComposer({isLoading, disabled, onStop, onSubmit})`.

Time-travel (editing a past human message and resubmitting, which forks the thread; switching between the resulting branches) is built here rather than as a separate feature: it's local UI state on top of the same human-message bubble, not a new screen. `OpsTranscript` owns which message is being edited; it never touches `useStream` directly — `getBranchInfo`/`onEditMessage`/`onSelectBranch` are thin callbacks the page (Task 11) wires to `stream.getMessagesMetadata` / `stream.submit(..., {checkpoint})` / `stream.setBranch`, so this component stays testable in isolation.

- [ ] **Step 1: Create the transcript**

`POC/web/src/components/ops/OpsTranscript.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { Message } from "@langchain/langgraph-sdk";
import type { BranchInfo, OpsEntry } from "../../lib/opsMessages";
import { HitlCard, type OpsInterruptValue } from "./HitlCard";
import { SkillBadge } from "./SkillBadge";

function BranchSwitcher(props: { branch: string | undefined; options: string[]; onSelect: (branch: string) => void }) {
  const i = Math.max(0, props.options.indexOf(props.branch ?? props.options[0]));
  return (
    <div className="flex items-center gap-1 font-mono text-[10px] text-muted">
      <button disabled={i <= 0} onClick={() => props.onSelect(props.options[i - 1])} className="disabled:opacity-30 hover:text-accent">
        ‹
      </button>
      <span>{i + 1}/{props.options.length}</span>
      <button
        disabled={i >= props.options.length - 1}
        onClick={() => props.onSelect(props.options[i + 1])}
        className="disabled:opacity-30 hover:text-accent"
      >
        ›
      </button>
    </div>
  );
}

function EditableHumanBubble(props: { initialText: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(props.initialText);
  return (
    <div className="w-full max-w-[85%] rounded-lg border border-accent/50 bg-surface p-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        className="w-full resize-none bg-transparent text-[13.5px] text-ink outline-none"
        autoFocus
      />
      <div className="mt-1 flex justify-end gap-2">
        <button onClick={props.onCancel} className="font-mono text-[10px] uppercase text-muted hover:text-ink">
          Cancel
        </button>
        <button
          onClick={() => value.trim() && props.onSave(value.trim())}
          className="font-mono text-[10px] uppercase text-accent hover:opacity-80"
        >
          Save &amp; resubmit
        </button>
      </div>
    </div>
  );
}

export function OpsTranscript(props: {
  entries: OpsEntry[];
  interruptValue: OpsInterruptValue | undefined;
  onRespond: (response: { decision: "approve" | "deny"; reason?: string }) => void;
  isResponding: boolean;
  getBranchInfo: (message: Message, index: number) => BranchInfo;
  onEditMessage: (message: Message, index: number, text: string) => void;
  onSelectBranch: (branch: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.entries.length, props.interruptValue]);

  if (props.entries.length === 0 && !props.interruptValue) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted/50">standing by</span>
        <p className="max-w-sm text-center font-display text-2xl leading-relaxed text-muted/70">
          Ask ops about the fleet.
        </p>
      </div>
    );
  }

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-2">
        {props.entries.map((e) => {
          if (e.kind === "human") {
            const info = props.getBranchInfo(e.message, e.index);
            return (
              <div key={e.id} className="entry-rise group flex flex-col items-end gap-1">
                {editingId === e.id ? (
                  <EditableHumanBubble
                    initialText={e.text}
                    onCancel={() => setEditingId(null)}
                    onSave={(text) => {
                      setEditingId(null);
                      props.onEditMessage(e.message, e.index, text);
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditingId(e.id)}
                      className="font-mono text-[10px] text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                      title="Edit and resubmit"
                    >
                      edit
                    </button>
                    <p className="max-w-[85%] rounded-lg bg-surface px-3.5 py-2 text-[13.5px] text-ink">{e.text}</p>
                  </div>
                )}
                {info.branchOptions && info.branchOptions.length > 1 && (
                  <BranchSwitcher branch={info.branch} options={info.branchOptions} onSelect={props.onSelectBranch} />
                )}
              </div>
            );
          }
          if (e.kind === "think") {
            return (
              <p key={e.id} className="scan-in border-l-2 border-line pl-3 font-display text-[13px] italic text-muted">
                {e.text}
                {e.status === "running" && (
                  <span className="cursor-blink ml-1 inline-block h-3 w-px bg-muted align-middle" />
                )}
              </p>
            );
          }
          if (e.kind === "answer") {
            return (
              <div key={e.id} className="entry-rise">
                <p className="max-w-[85%] rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
                  {e.text}
                </p>
              </div>
            );
          }
          return (
            <div key={e.id} className="scan-in flex items-center gap-2.5 rounded-md border border-line bg-panel px-3 py-2">
              <span className={`inline-block size-1.5 rounded-full ${
                e.status === "running" ? "pulse led-live bg-accent text-accent" : e.denied ? "bg-bad" : "bg-ok"
              }`} />
              <SkillBadge skill={e.skill} />
              <code className="font-mono text-[12px] text-ink">{e.name}</code>
              <span className="truncate font-mono text-[10.5px] text-muted/70">{e.args}</span>
              {e.denied && <span className="ml-auto font-mono text-[10px] uppercase text-bad">denied</span>}
            </div>
          );
        })}
        {props.interruptValue && (
          <HitlCard value={props.interruptValue} onRespond={props.onRespond} pending={props.isResponding} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the composer**

`POC/web/src/components/ops/OpsComposer.tsx`:

```tsx
import { useState } from "react";

export function OpsComposer(props: {
  isLoading: boolean;
  disabled: boolean;
  onStop: () => void;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !props.isLoading && !props.disabled) {
          props.onSubmit(value.trim());
          setValue("");
        }
      }}
      className="border-t border-line px-6 py-4"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={props.disabled}
          placeholder={props.disabled ? "Resolve the pending approval to continue…" : "Ask about the fleet…"}
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-[13px] outline-none placeholder:text-muted transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-50"
        />
        {props.isLoading ? (
          <button
            type="button"
            onClick={props.onStop}
            className="rounded-md border border-bad px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-bad transition-colors hover:bg-bad/10"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || props.disabled}
            className="rounded-md bg-accent px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-bg transition-opacity disabled:opacity-40 hover:enabled:opacity-90"
          >
            Send
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Verify type-check**

Run: `cd POC/web && npx tsc -b --noEmit`
Expected: no new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add POC/web/src/components/ops/OpsTranscript.tsx POC/web/src/components/ops/OpsComposer.tsx
git commit -m "feat: add OpsTranscript and OpsComposer components"
```

---

### Task 11: Wire the Ops Desk page

**Files:**
- Create: `POC/web/src/pages/OpsDeskPage.tsx`

**Interfaces:**
- Consumes: everything from Tasks 6–10 (`TopBar`, `ThreadSidebar`, `tagThread`, `deriveOpsTranscript`, `OpsBoardEvent`, `OpsService`, `OpsTranscript`, `OpsComposer`, `OpsBoard`, `OpsInterruptValue`). Wires `OpsTranscript`'s `getBranchInfo`/`onEditMessage`/`onSelectBranch` to `stream.getMessagesMetadata` / `stream.submit(..., {checkpoint})` / `stream.setBranch` — this is the only place `useStream`'s checkpoint-branching API is touched.
- Produces: `OpsDeskPage` default export (`{theme, onToggleTheme}` props), consumed by `App.tsx` (Task 6).

- [ ] **Step 1: Create the page**

`POC/web/src/pages/OpsDeskPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { ThreadSidebar } from "../components/ThreadSidebar";
import { TopBar } from "../components/TopBar";
import { OpsTranscript } from "../components/ops/OpsTranscript";
import { OpsComposer } from "../components/ops/OpsComposer";
import { OpsBoard } from "../components/ops/OpsBoard";
import type { OpsInterruptValue } from "../components/ops/HitlCard";
import { deriveOpsTranscript, type OpsBoardEvent, type OpsService } from "../lib/opsMessages";
import { tagThread } from "../lib/tagThread";
import type { Theme } from "../lib/theme";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:2024";
const ASSISTANT_ID = "ops_agent";

export default function OpsDeskPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(
    () => sessionStorage.getItem("ops-thread"),
  );
  const [threadListTick, setThreadListTick] = useState(0);
  const [services, setServices] = useState<OpsService[]>([]);
  const [isResponding, setIsResponding] = useState(false);

  const stream = useStream({
    apiUrl: API_URL,
    assistantId: ASSISTANT_ID,
    messagesKey: "messages",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      if (id) {
        sessionStorage.setItem("ops-thread", id);
        tagThread(API_URL, id, ASSISTANT_ID);
      }
    },
    onCustomEvent: (event) => {
      const e = event as OpsBoardEvent;
      if (e.type === "board") setServices(e.services);
    },
    reconnectOnMount: true,
  });

  useEffect(() => {
    if (!stream.isLoading) setThreadListTick((n) => n + 1);
  }, [stream.isLoading]);

  useEffect(() => {
    setIsResponding(false);
  }, [stream.interrupt]);

  const entries = deriveOpsTranscript(stream.messages);
  const interruptValue = stream.interrupt?.value as OpsInterruptValue | undefined;
  const status = stream.error ? "error" : stream.isLoading ? "running" : "idle";

  function resetThread() {
    sessionStorage.removeItem("ops-thread");
    setThreadId(null);
    setServices([]);
  }

  return (
    <>
      <TopBar
        title="OPS DESK"
        subtitle="fleet-response console"
        status={status}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onNewThread={resetThread}
      />
      {stream.error != null && (
        <div className="border-b border-bad/30 bg-bad/5 px-6 py-3 font-mono text-xs text-bad">
          <span className="font-semibold">ERROR //</span> {String((stream.error as Error).message ?? stream.error)} — is Aegra running on :2024?
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ThreadSidebar
          apiUrl={API_URL}
          assistantId={ASSISTANT_ID}
          activeThreadId={threadId}
          refreshKey={threadListTick}
          onSelect={(id) => {
            setThreadId(id);
            sessionStorage.setItem("ops-thread", id);
            setServices([]);
          }}
          onNew={resetThread}
        />
        <section className="flex min-w-0 flex-1 flex-col">
          <OpsTranscript
            entries={entries}
            interruptValue={interruptValue}
            isResponding={isResponding}
            onRespond={(response) => {
              setIsResponding(true);
              stream.submit(undefined, { command: { resume: response } });
            }}
            getBranchInfo={(message, index) => {
              const meta = stream.getMessagesMetadata(message, index);
              return { branch: meta?.branch, branchOptions: meta?.branchOptions };
            }}
            onEditMessage={(message, index, text) => {
              const meta = stream.getMessagesMetadata(message, index);
              stream.submit(
                { messages: [{ type: "human", content: text }] },
                { checkpoint: meta?.firstSeenState?.parent_checkpoint ?? undefined },
              );
            }}
            onSelectBranch={(branch) => stream.setBranch(branch)}
          />
          <OpsComposer
            isLoading={stream.isLoading}
            disabled={Boolean(stream.interrupt)}
            onStop={() => stream.stop()}
            onSubmit={(text) => stream.submit({ messages: [{ type: "human", content: text }] })}
          />
        </section>
        <OpsBoard services={services} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Full build check**

Run: `cd POC/web && npm run build`
Expected: `tsc -b && vite build` completes with no errors (this is the first point where every file from Tasks 6–11 is wired together and type-checked as a whole).

- [ ] **Step 3: Commit**

```bash
git add POC/web/src/pages/OpsDeskPage.tsx
git commit -m "feat: wire the Ops Desk page (chat, HITL, live fleet board)"
```

---

### Task 12: Manual verification + README update

**Files:**
- Modify: `POC/README.md`

**Interfaces:** none — documentation + manual UI verification only.

- [ ] **Step 1: Manual verification with both servers running**

Terminal A: `cd POC/agent && uv run aegra dev --port 2024`
Terminal B: `cd POC/web && npm run dev`, open `http://localhost:5173`

Check:
1. The top nav shows "Ad Insight" and "Ops Desk" links; the Ad Insight page still works exactly as before (submit a question, see the timeline and report stream).
2. Navigate to `/ops`. Ask something like *"checkout-service seems degraded, can you look into it and fix it?"*.
3. `think` asides stream in as italic lines before each tool call.
4. Read tool calls (`get_service_status`, `get_metrics`, `search_logs`) appear one at a time, each tagged with a `DIAGNOSTICS` badge.
5. When the model calls `restart_service` (or `scale_service`/`rollback_deploy`), the composer disables and a HITL card appears with a preview and Approve/Deny buttons.
6. Click **Approve** — the card resolves, the Ops Board on the right updates the affected service's status/replicas/error rate, and the agent's final answer streams in.
7. Start a fresh thread, trigger another risky action, click **Deny** — confirm the transcript shows a "denied" tag on that tool call and the agent's final answer acknowledges the denial instead of claiming success.
8. Reload the page mid-run on a new question — confirm it reattaches (same `sessionStorage` + `reconnectOnMount` pattern as the Ad Insight page).
9. Toggle light/dark theme — confirm it affects both pages consistently.
10. Hover a past human message — an "edit" affordance appears. Click it, change the text, click **Save & resubmit** — confirm the graph reruns from that point (a new answer streams in) and a `‹ 1/2 ›` branch switcher appears under that message.
11. Click `‹`/`›` on the branch switcher — confirm it swaps the transcript between the original and edited conversation branches (`stream.setBranch`), without issuing a new run.

If `getMessagesMetadata`'s returned shape doesn't match what Task 10/11 assumed (SDK minor-version drift is possible — this was verified against the installed `@langchain/langgraph-sdk` version at plan-writing time), inspect the actual object in the browser devtools console and adjust `getBranchInfo`/`onEditMessage` in `OpsDeskPage.tsx` accordingly; the rest of the plan does not depend on this detail.

- [ ] **Step 2: Update the README**

Append a new section at the end of `POC/README.md` (after the existing `## 7. Deploy to production (free tier)` section), and update the two spots noted below.

First, in the "Agent unit tests" section (around line 113-120), replace the test count:

Old:
```
All 6 tests should pass without a running server or real Azure credentials (tools operate on the mock dataset only).
```

New:
```
All 36 tests should pass without a running server or real Azure credentials (tools operate on mock data only).
```

Then append this new section at the end of the file:

```markdown
---

## 8. Ops Desk — a second showcase page

A second page (`/ops` in the same frontend, nav link in the top bar) demonstrates interactive LangGraph/agent-UI techniques that don't fit the Ad Insight product story: a hand-rolled tool-calling loop (no `create_react_agent`), a live "thinking" stream, human-in-the-loop approval of risky actions, live skill badges, and checkpoint-based time-travel. It plays a different, unrelated character — an on-call assistant for a small mock service fleet — purely to showcase the techniques, not a BossAd feature.

### What it shows

- **Hand-rolled graph** (`POC/agent/src/agent/ops/ops_graph.py`): a plain `agent ⇄ tools` `StateGraph`, no LangChain prebuilt agent wrapper.
- **Live thinking stream**: the model calls a `think` tool before every other action; the UI renders those calls as italic asides, streamed live.
- **HITL approval**: `restart_service`, `scale_service`, and `rollback_deploy` call `interrupt()` before running. The UI shows an Approve/Deny card; denying records the denial without mutating the mock fleet.
- **Live fleet board**: the right-hand panel updates from a server-emitted snapshot after every tool call — never guessed client-side.
- **Skill badges**: each tool call is tagged `DIAGNOSTICS`, `SCALING`, or `RECOVERY` based on which tool ran.
- **Time-travel**: edit a past message and resubmit to fork the thread — this is `useStream`'s built-in checkpoint branching (`history`, `branch`, `setBranch`), not custom code.

### Try it

With both servers running (§3 above), open `http://localhost:5173/ops` and ask something like *"checkout-service is showing a high error rate, can you look into it?"*. Approve the resulting restart request and watch the fleet board update; start a fresh thread and try denying one instead.

### Smoke test

```bash
cd POC/agent
uv run python ../scripts/smoke_ops.py
```

Drives a run into a risky tool call on two separate threads — one resumed with approve, one with deny — and asserts both the interrupt and the resume behaved correctly.

### Note on existing threads

Thread lists are now filtered per page via thread metadata (`graph_id`), tagged the moment a thread is created. Ad Insight threads created before this feature shipped predate that tag and won't appear in the (now-filtered) sidebar — a one-time, expected side effect of adding a second graph to a single-graph POC's Postgres data.
```

- [ ] **Step 3: Commit**

```bash
git add POC/README.md
git commit -m "docs: document the Ops Desk showcase page"
```
