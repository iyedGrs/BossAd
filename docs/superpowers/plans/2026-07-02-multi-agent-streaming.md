# Multi-Agent Streaming + Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-node POC agent into a supervisor + 3-subagent LangGraph graph that streams phase-level custom events and mid-run narration messages to the browser, then restyle the UI with a light/dark theme.

**Architecture:** A `supervisor` node holds a pure decision function that inspects graph state (`search_results`, `scores`, `report_done`) and appends a one-line handoff message before routing to `market_scout`, `scoring_analyst`, or `report_writer` — each a `create_react_agent` (or plain LLM call for the writer) scoped to one tool. Each subagent dispatches `adispatch_custom_event` on entry/exit; the frontend picks these up via `useStream`'s `onCustomEvent` and renders them as a live step timeline, grouped by subagent, restyled with a light/dark theme.

**Tech Stack:** Python 3.12+, langgraph>=1.0, langchain-openai>=1.0 (backend, `POC/agent/`); React 19 + Vite + TypeScript + Tailwind 4, `@langchain/langgraph-sdk` react hooks (frontend, `POC/web/`).

## Global Constraints

- No new tools beyond `search_ads` and `compare_products` — "skills" means scoping the existing two tools per subagent, not adding capabilities.
- Deterministic routing only — no LLM-driven supervisor.
- No auth, no real Meta Ad Library data, no production/deploy changes.
- No layout restructuring in the frontend — restyle the existing 3-pane structure (Threads / Composer+Timeline / Live report) only.
- The repo has no JS test runner configured (`POC/web/package.json` has no `test` script) — frontend tasks are verified by `npm run build` (typecheck) plus the manual/smoke checks in the final task, not new unit tests. Do not add a test framework as part of this plan.
- `useStream`'s `onCustomEvent` option automatically adds `"custom"` to the SDK's internal `streamMode` list (verified in `@langchain/langgraph-sdk` v1.9.25 source, `dist/react/stream.lgp.cjs:139-148`) — do not also pass a manual `streamMode` config; passing `onCustomEvent` is sufficient.
- Backend custom events use `adispatch_custom_event(name: str, data: Any)` from `langchain_core.callbacks.manager` (verified signature against the installed `langchain-core` in `POC/agent`).

---

### Task 1: State schema + pure routing decision function

**Files:**
- Create: `POC/agent/src/agent/state.py`
- Create: `POC/agent/src/agent/router.py`
- Test: `POC/agent/tests/test_router.py`

**Interfaces:**
- Produces: `AgentState` (TypedDict) with fields `messages: Annotated[list, add_messages]`, `search_results: list[dict] | None`, `scores: list[dict] | None`, `report_done: bool`. Used by Task 3 (graph wiring) and Task 4 (extraction helpers).
- Produces: `decide_next(state: AgentState) -> Literal["market_scout", "scoring_analyst", "report_writer", "end"]`. Used by Task 3's supervisor node.

- [ ] **Step 1: Write the failing tests for `decide_next`**

```python
# POC/agent/tests/test_router.py
from agent.router import decide_next


def _state(search_results=None, scores=None, report_done=False):
    return {
        "messages": [],
        "search_results": search_results,
        "scores": scores,
        "report_done": report_done,
    }


def test_routes_to_scout_when_no_search_results():
    assert decide_next(_state()) == "market_scout"


def test_routes_to_analyst_when_results_but_no_scores():
    assert decide_next(_state(search_results=[{"ad_id": "ad_0001"}])) == "scoring_analyst"


def test_routes_to_writer_when_scores_present():
    assert decide_next(
        _state(search_results=[{"ad_id": "ad_0001"}], scores=[{"product": "A", "score": 80}])
    ) == "report_writer"


def test_routes_to_end_when_report_done():
    assert decide_next(
        _state(
            search_results=[{"ad_id": "ad_0001"}],
            scores=[{"product": "A", "score": 80}],
            report_done=True,
        )
    ) == "end"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd POC/agent && uv run pytest tests/test_router.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.router'`

- [ ] **Step 3: Write the state schema**

```python
# POC/agent/src/agent/state.py
"""Shared graph state for the supervisor + subagent graph."""
from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    search_results: list[dict] | None
    scores: list[dict] | None
    report_done: bool
```

- [ ] **Step 4: Write the minimal router implementation**

```python
# POC/agent/src/agent/router.py
"""Pure decision function for the supervisor node — no LLM call, no I/O."""
from typing import Literal

from agent.state import AgentState

Phase = Literal["market_scout", "scoring_analyst", "report_writer", "end"]


def decide_next(state: AgentState) -> Phase:
    if state.get("report_done"):
        return "end"
    if state.get("search_results") is None:
        return "market_scout"
    if state.get("scores") is None:
        return "scoring_analyst"
    return "report_writer"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd POC/agent && uv run pytest tests/test_router.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add POC/agent/src/agent/state.py POC/agent/src/agent/router.py POC/agent/tests/test_router.py
git commit -m "feat: add graph state schema and pure supervisor routing function"
```

---

### Task 2: Tool-output extraction helper

**Files:**
- Modify: `POC/agent/src/agent/tools.py` (no logic change — read to confirm tool names, already read: `search_ads`, `compare_products`)
- Create: `POC/agent/src/agent/extract.py`
- Test: `POC/agent/tests/test_extract.py`

**Interfaces:**
- Consumes: nothing new — operates on plain `ToolMessage`-shaped dicts/objects with `.name` and `.content` (JSON string), matching what `langchain_core.messages.ToolMessage` produces.
- Produces: `extract_tool_json(messages: list, tool_name: str) -> list[dict] | None`. Used by Task 3's subagent node wrappers to populate `search_results`/`scores` in state.

- [ ] **Step 1: Write the failing test**

```python
# POC/agent/tests/test_extract.py
import json

from langchain_core.messages import AIMessage, ToolMessage

from agent.extract import extract_tool_json


def test_extract_tool_json_finds_last_matching_tool_message():
    messages = [
        AIMessage(content="", tool_calls=[{"name": "search_ads", "args": {}, "id": "call_1"}]),
        ToolMessage(content=json.dumps([{"ad_id": "ad_0001"}]), tool_call_id="call_1", name="search_ads"),
    ]
    result = extract_tool_json(messages, "search_ads")
    assert result == [{"ad_id": "ad_0001"}]


def test_extract_tool_json_returns_none_when_absent():
    assert extract_tool_json([AIMessage(content="hi")], "search_ads") is None


def test_extract_tool_json_picks_last_when_multiple():
    messages = [
        ToolMessage(content=json.dumps([{"ad_id": "ad_0001"}]), tool_call_id="call_1", name="search_ads"),
        ToolMessage(content=json.dumps([{"ad_id": "ad_0002"}]), tool_call_id="call_2", name="search_ads"),
    ]
    result = extract_tool_json(messages, "search_ads")
    assert result == [{"ad_id": "ad_0002"}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd POC/agent && uv run pytest tests/test_extract.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.extract'`

- [ ] **Step 3: Write the minimal implementation**

```python
# POC/agent/src/agent/extract.py
"""Pulls structured tool output back out of a subagent's message trail."""
import json


def extract_tool_json(messages: list, tool_name: str) -> list[dict] | None:
    for msg in reversed(messages):
        if getattr(msg, "name", None) == tool_name and getattr(msg, "content", None) is not None:
            return json.loads(msg.content)
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd POC/agent && uv run pytest tests/test_extract.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add POC/agent/src/agent/extract.py POC/agent/tests/test_extract.py
git commit -m "feat: add tool-output extraction helper for subagent state updates"
```

---

### Task 3: Split system prompts per subagent

**Files:**
- Modify: `POC/agent/src/agent/prompts.py` (currently one `SYSTEM_PROMPT`, full contents already read — see below)

**Interfaces:**
- Produces: `SCOUT_PROMPT: str`, `ANALYST_PROMPT: str`, `WRITER_PROMPT: str`. Used by Task 4's subagent construction.

- [ ] **Step 1: Replace the single prompt with three scoped prompts**

```python
# POC/agent/src/agent/prompts.py
SCOUT_PROMPT = """You are the Market Scout for the BossAd insight agent (proof-of-concept). \
Your only job is to explore the local Meta-ads archive for the zone and product question you're given.

Use `search_ads` to explore the zone — start broad with query="", then narrow by product/category. \
Call it as many times as needed to identify every candidate product worth scoring. \
Do not invent ads, numbers, or advertisers — only report what the tool returns. \
When you've identified the candidate products, stop calling tools and write ONE short \
sentence naming the candidates you found (no heading, no markdown)."""

ANALYST_PROMPT = """You are the Scoring Analyst for the BossAd insight agent (proof-of-concept). \
You're given a zone and a list of candidate products already identified by the Market Scout.

Call `compare_products` once with all candidate product names and the zone to score them. \
Do not invent numbers — only report what the tool returns. \
When scoring is complete, write ONE short sentence summarizing the ranking (no heading, no markdown)."""

WRITER_PROMPT = """You are the Report Writer for the BossAd insight agent (proof-of-concept). \
You're given the full conversation trail: the original question, the Market Scout's search \
results, and the Scoring Analyst's rankings. Ground EVERY claim in that trail only — never \
invent ads, numbers, or advertisers. If the archive had nothing relevant, say so honestly.

Write the final answer as a Markdown report with EXACTLY these sections:
# <Punchy report title>
## Verdict
One bolded winner (or honest no-winner/greenfield call) and a 2-sentence rationale.
## Signals
A GFM table: Product | Days running | EU reach | Score | Reading.
## Reasoning trail
Numbered steps: what was searched, what was found, what was ruled out and why.
## Caveats
Data window, mock-data notice, what production data would add.

Rules: cite ad_ids inline like (ad_0007). Keep the whole report under 450 words. \
The report must stand alone — no references to "the tool", "the Scout", "the Analyst", \
or this conversation."""
```

- [ ] **Step 2: Verify the module still imports cleanly**

Run: `cd POC/agent && uv run python -c "from agent.prompts import SCOUT_PROMPT, ANALYST_PROMPT, WRITER_PROMPT; print('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add POC/agent/src/agent/prompts.py
git commit -m "refactor: split single system prompt into per-subagent prompts"
```

---

### Task 4: Build the supervisor + subagent graph

**Files:**
- Modify: `POC/agent/src/agent/graph.py` (full current contents already read — replace the bottom `create_react_agent(...)` construction)

**Interfaces:**
- Consumes: `AgentState` from Task 1 (`agent.state`), `decide_next` from Task 1 (`agent.router`), `extract_tool_json` from Task 2 (`agent.extract`), `SCOUT_PROMPT`/`ANALYST_PROMPT`/`WRITER_PROMPT` from Task 3 (`agent.prompts`), `search_ads`/`compare_products` from `agent.tools` (unchanged).
- Produces: module-level `graph` compiled `StateGraph`, same public symbol Aegra already loads via `aegra.json` (`"agent": "./src/agent/graph.py:graph"` — no change needed there).

- [ ] **Step 1: Replace the graph construction**

Keep lines 1–33 of `POC/agent/src/agent/graph.py` unchanged (env loading, `model = ChatOpenAI(...)`). Replace the final line (`graph = create_react_agent(...)`) with:

```python
import json

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import AIMessage
from langgraph.graph import END, START, StateGraph

from agent.extract import extract_tool_json
from agent.prompts import ANALYST_PROMPT, SCOUT_PROMPT, WRITER_PROMPT
from agent.router import decide_next
from agent.state import AgentState

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
    await adispatch_custom_event("phase", {"phase": next_phase, "status": "start",
                                            "label": _PHASE_LABELS[next_phase]})
    return {"messages": [AIMessage(content=_PHASE_LABELS[next_phase])]}


def route_from_supervisor(state: AgentState) -> str:
    return decide_next(state) if decide_next(state) != "end" else END


async def market_scout_node(state: AgentState) -> dict:
    result = await _scout_agent.ainvoke({"messages": state["messages"]})
    new_messages = result["messages"][len(state["messages"]):]
    search_results = extract_tool_json(new_messages, "search_ads") or []
    await adispatch_custom_event("phase", {"phase": "market_scout", "status": "done",
                                            "label": f"Found {len(search_results)} candidate ads"})
    return {"messages": new_messages, "search_results": search_results}


async def scoring_analyst_node(state: AgentState) -> dict:
    result = await _analyst_agent.ainvoke({"messages": state["messages"]})
    new_messages = result["messages"][len(state["messages"]):]
    scores = extract_tool_json(new_messages, "compare_products") or []
    await adispatch_custom_event("phase", {"phase": "scoring_analyst", "status": "done",
                                            "label": f"Scored {len(scores)} products"})
    return {"messages": new_messages, "scores": scores}


async def report_writer_node(state: AgentState) -> dict:
    response = await model.ainvoke(
        [{"role": "system", "content": WRITER_PROMPT}, *state["messages"]]
    )
    await adispatch_custom_event("phase", {"phase": "report_writer", "status": "done",
                                            "label": "Report complete"})
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

Note: `route_from_supervisor` calls `decide_next` again after `supervisor_node` already appended the handoff message — this is safe because `decide_next` only reads `search_results`/`scores`/`report_done`, none of which `supervisor_node` mutates; only `messages` changes, which `decide_next` never inspects.

- [ ] **Step 2: Verify the module compiles without a running server**

This requires real Azure credentials to construct `ChatOpenAI`, matching the existing behavior of `graph.py` (it already raises `RuntimeError` if env vars are missing — unchanged). Run:

`cd POC/agent && uv run python -c "from agent.graph import graph; print([n for n in graph.get_graph().nodes])"`

Expected: prints a list including `__start__`, `supervisor`, `market_scout`, `scoring_analyst`, `report_writer`, `__end__` (exact order may vary). If it raises `RuntimeError: Missing env vars`, that means `POC/agent/.env` isn't filled in on this machine — confirm `.env` has real Azure credentials before proceeding (same precondition the existing POC already has).

- [ ] **Step 3: Run the full existing test suite to confirm nothing broke**

Run: `cd POC/agent && uv run pytest tests/ -v`
Expected: all tests pass (the 5 original tool tests + 4 router tests + 3 extract tests = 12 passed)

- [ ] **Step 4: Commit**

```bash
git add POC/agent/src/agent/graph.py
git commit -m "feat: replace single ReAct agent with supervisor + 3-subagent graph"
```

---

### Task 5: Extend the smoke test for multi-agent behavior

**Files:**
- Modify: `POC/scripts/smoke.py` (full current contents already read)

**Interfaces:**
- Consumes: the compiled `graph` from Task 4 via the running Aegra server (unchanged integration point — no new interface, just richer assertions on the existing `client.runs.stream` output).

- [ ] **Step 1: Replace the assertion logic with multi-agent checks**

```python
"""End-to-end smoke test: create thread, stream a run, assert subagent order,
tool calls from both subagents, mid-run streaming, and final report.
Run from POC/agent:  uv run python ../scripts/smoke.py
Exit 0 on success, 1 on failure.
"""
import asyncio
import sys

from langgraph_sdk import get_client


async def main() -> int:
    client = get_client(url="http://localhost:2024")
    thread = await client.threads.create()

    tool_names_seen = set()
    ai_message_texts: list[str] = []
    phase_events: list[dict] = []
    final_text = ""

    async for chunk in client.runs.stream(
        thread_id=thread["thread_id"],
        assistant_id="agent",
        input={"messages": [{"type": "human",
                             "content": "What's winning in Berlin for fitness products?"}]},
        stream_mode=["messages-tuple", "custom"],
    ):
        if chunk.event == "custom":
            phase_events.append(chunk.data)
        elif chunk.event.startswith("messages"):
            msg = chunk.data[0] if isinstance(chunk.data, list) else chunk.data
            for tc in (msg.get("tool_calls") or []):
                if tc.get("name"):
                    tool_names_seen.add(tc["name"])
            if msg.get("type") == "ai" and isinstance(msg.get("content"), str) and msg["content"]:
                if msg["content"] not in ai_message_texts:
                    ai_message_texts.append(msg["content"])
                final_text = msg["content"] if "## Verdict" in msg["content"] else final_text

    phase_order = [e["phase"] for e in phase_events if e.get("status") == "start"]
    ok_order = phase_order == ["market_scout", "scoring_analyst", "report_writer"]
    ok_tools = {"search_ads", "compare_products"} <= tool_names_seen
    ok_mid_run = len(ai_message_texts) >= 2
    ok_report = "## Verdict" in final_text

    print(f"phase order {phase_order}: {ok_order}")
    print(f"both tools called: {ok_tools}")
    print(f"mid-run AI messages observed ({len(ai_message_texts)}): {ok_mid_run}")
    print(f"report contains '## Verdict': {ok_report}")
    print(f"---\n{final_text[:600]}\n---")
    return 0 if (ok_order and ok_tools and ok_mid_run and ok_report) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: Run against a live Aegra server to verify**

This step requires the agent server running (`uv run aegra dev --port 2024` in a separate terminal, real Azure credentials in `.env`). Run:

`cd POC/agent && uv run python ../scripts/smoke.py`

Expected output ends with all four `True` lines and exit code 0. If `ok_order` is `False` because no `custom` events arrived at all (empty `phase_events`), that means Aegra isn't passing the `custom` stream mode through — stop and report this back before continuing to Task 6, since Task 6's frontend wiring depends on the same mechanism working.

- [ ] **Step 3: Commit**

```bash
git add POC/scripts/smoke.py
git commit -m "test: extend smoke test for subagent order, tool coverage, and mid-run streaming"
```

---

### Task 6: Wire custom events into the frontend stream

**Files:**
- Modify: `POC/web/src/App.tsx` (full current contents already read)

**Interfaces:**
- Consumes: `useStream`'s `onCustomEvent` callback (confirmed present in `@langchain/langgraph-sdk` v1.9.25 — passing it auto-enables `"custom"` in the SDK's internal stream mode list, no manual `streamMode` config needed).
- Produces: a `phases: PhaseEvent[]` React state array (component-local), each entry `{ phase: string; status: "start" | "done"; label: string }` — matches the JSON shape dispatched by `POC/agent/src/agent/graph.py`'s `adispatch_custom_event("phase", {...})` calls. Used by Task 7 (`lib/messages.ts` merge) and Task 8 (`AgentTimeline` rendering).

- [ ] **Step 1: Add phase-event state and the `onCustomEvent` handler**

In `POC/web/src/App.tsx`, add near the top (after the existing imports):

```tsx
type PhaseEvent = { phase: string; status: "start" | "done"; label: string };
```

Change the `useStream({...})` call to add state and the callback:

```tsx
  const [phases, setPhases] = useState<PhaseEvent[]>([]);
  const stream = useStream({
    apiUrl: API_URL,
    assistantId: "agent",
    messagesKey: "messages",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      if (id) sessionStorage.setItem("poc-thread", id);
    },
    onCustomEvent: (event) => {
      setPhases((prev) => [...prev, event as PhaseEvent]);
    },
    reconnectOnMount: true,
  });
```

Reset `phases` on new thread — in the `onNew` handlers for both the header button and `ThreadSidebar`, add `setPhases([])` alongside the existing `sessionStorage.removeItem` / `setThreadId(null)` calls (three call sites: the header "New thread" button, `ThreadSidebar`'s `onNew`, and `ThreadSidebar`'s `onSelect` should also reset since switching threads clears prior phase history):

```tsx
          onClick={() => { sessionStorage.removeItem("poc-thread"); setThreadId(null); setPhases([]); }}
```

```tsx
          onSelect={(id) => {
            setThreadId(id);
            sessionStorage.setItem("poc-thread", id);
            setPhases([]);
          }}
          onNew={() => {
            sessionStorage.removeItem("poc-thread");
            setThreadId(null);
            setPhases([]);
          }}
```

- [ ] **Step 2: Pass `phases` down to `AgentTimeline`**

Change:

```tsx
          <AgentTimeline entries={timeline} />
```

to:

```tsx
          <AgentTimeline entries={timeline} phases={phases} />
```

(Task 7 updates `deriveTimeline`'s consumer signature and Task 8 updates `AgentTimeline` to accept the new prop — this step alone will not typecheck until Task 8 lands; that's expected mid-plan and resolved by the end of Task 8.)

- [ ] **Step 3: Typecheck (expect a known, temporary error)**

Run: `cd POC/web && npx tsc -b --noEmit`
Expected: FAILS with an error on `AgentTimeline` not accepting a `phases` prop — this confirms Step 2's wiring compiled correctly up to the point where `AgentTimeline` needs updating in Task 8. Do not fix `AgentTimeline` in this task — that's Task 8's job, kept separate so this task's diff stays scoped to `App.tsx`.

- [ ] **Step 4: Commit**

```bash
git add POC/web/src/App.tsx
git commit -m "feat: capture custom phase events from useStream into component state"
```

---

### Task 7: Merge phase events into the timeline data model

**Files:**
- Modify: `POC/web/src/lib/messages.ts` (full current contents already read)

**Interfaces:**
- Consumes: `PhaseEvent[]` shape from Task 6 (`{ phase: string; status: "start" | "done"; label: string }`).
- Produces: extends `TimelineEntry` with an optional `subagent?: "market_scout" | "scoring_analyst" | "report_writer"` field, and a new exported function `mergeTimeline(entries: TimelineEntry[], phases: PhaseEvent[]): TimelineEntry[]` that inserts phase-start entries in order, tagging subsequent tool entries with the active subagent. Used by Task 8 (`AgentTimeline` grouping/coloring).

- [ ] **Step 1: Extend `TimelineEntry` and add `mergeTimeline`**

Replace the `TimelineEntry` type and add the new function at the end of `POC/web/src/lib/messages.ts`:

```ts
export type TimelineEntry = {
  id: string;
  kind: "plan" | "tool" | "phase";
  label: string;
  args?: string;
  result?: string;
  status: "running" | "done";
  subagent?: "market_scout" | "scoring_analyst" | "report_writer";
};

export type PhaseEvent = { phase: string; status: "start" | "done"; label: string };

const SUBAGENT_BY_TOOL: Record<string, NonNullable<TimelineEntry["subagent"]>> = {
  search_ads: "market_scout",
  compare_products: "scoring_analyst",
};

const PHASE_ORDER: NonNullable<TimelineEntry["subagent"]>[] = [
  "market_scout",
  "scoring_analyst",
  "report_writer",
];

/** Groups timeline entries by which subagent's tool they belong to (tool name
 * uniquely identifies the subagent — search_ads only runs in market_scout,
 * compare_products only in scoring_analyst) and interleaves each group with
 * its phase-start marker, in the graph's fixed pipeline order. This relies on
 * the pipeline order being deterministic (see agent/router.py decide_next),
 * not on message/event arrival timing, since the two arrive on separate
 * streams with no shared sequence key. */
export function mergeTimeline(entries: TimelineEntry[], phases: PhaseEvent[]): TimelineEntry[] {
  const startLabels = new Map(
    phases.filter((p) => p.status === "start").map((p) => [p.phase, p.label] as const),
  );
  const tagged = entries.map((e) => ({
    ...e,
    subagent: e.kind === "tool" ? SUBAGENT_BY_TOOL[e.label] : undefined,
  }));

  const merged: TimelineEntry[] = tagged.filter((e) => !e.subagent && e.kind !== "tool");
  for (const subagent of PHASE_ORDER) {
    const label = startLabels.get(subagent);
    if (label) {
      merged.push({ id: `phase-${subagent}`, kind: "phase", label, status: "done", subagent });
    }
    merged.push(...tagged.filter((e) => e.subagent === subagent));
  }
  return merged;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd POC/web && npx tsc -b --noEmit`
Expected: still fails only on the `AgentTimeline` prop mismatch from Task 6 (unchanged) — no new errors from `messages.ts` itself. Confirm by checking the error output only references `AgentTimeline.tsx`/`App.tsx`, not `messages.ts`.

- [ ] **Step 3: Commit**

```bash
git add POC/web/src/lib/messages.ts
git commit -m "feat: merge custom phase events into the timeline entry list"
```

---

### Task 8: Update `AgentTimeline` to render grouped subagent steps

**Files:**
- Modify: `POC/web/src/components/AgentTimeline.tsx` (full current contents already read)
- Modify: `POC/web/src/App.tsx` (one-line change to call `mergeTimeline`)

**Interfaces:**
- Consumes: `TimelineEntry` (extended, with `kind: "phase"` and `subagent`) and `PhaseEvent` from Task 7, `mergeTimeline` from Task 7.

- [ ] **Step 1: Call `mergeTimeline` in `App.tsx`, and dedupe the `PhaseEvent` type**

`POC/web/src/lib/messages.ts` (Task 7) now exports its own `PhaseEvent`. Remove the
local `type PhaseEvent = {...}` declaration Task 6 added to `App.tsx` and import it
instead, so there's a single source of truth for the shape:

```tsx
import { deriveReport, deriveTimeline, mergeTimeline, type PhaseEvent } from "./lib/messages";
```

Delete this line (added in Task 6, now redundant):

```tsx
type PhaseEvent = { phase: string; status: "start" | "done"; label: string };
```

`useState<PhaseEvent[]>` and the `onCustomEvent` handler from Task 6 keep working
unchanged — only the type's origin moves from a local declaration to an import.

Then update the `AgentTimeline` usage:

```tsx
  const timeline = mergeTimeline(deriveTimeline(stream.messages), phases);
```

```tsx
          <AgentTimeline entries={timeline} />
```

(Revert the Task 6 `phases={phases}` prop — `phases` is now consumed via `mergeTimeline` before rendering, so `AgentTimeline` only needs `entries`.)

- [ ] **Step 2: Add subagent color/label mapping and a `phase` entry renderer to `AgentTimeline.tsx`**

```tsx
import { useState } from "react";
import type { TimelineEntry } from "../lib/messages";

const SUBAGENT_META: Record<string, { label: string; color: string }> = {
  market_scout: { label: "Scout", color: "text-accent" },
  scoring_analyst: { label: "Analyst", color: "text-ok" },
  report_writer: { label: "Writer", color: "text-ink" },
};

function Chip({ status }: { status: TimelineEntry["status"] }) {
  return status === "running" ? (
    <span className="pulse inline-block size-2 rounded-full bg-accent" title="running" />
  ) : (
    <span className="inline-block size-2 rounded-full bg-ok" title="done" />
  );
}

function SubagentTag({ subagent }: { subagent?: TimelineEntry["subagent"] }) {
  if (!subagent) return null;
  const meta = SUBAGENT_META[subagent];
  if (!meta) return null;
  return <span className={`text-[10px] font-medium uppercase tracking-wide ${meta.color}`}>{meta.label}</span>;
}

export function AgentTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (entries.length === 0)
    return <p className="p-5 text-xs text-muted">Agent activity will appear here.</p>;
  return (
    <ol className="space-y-1 p-4">
      {entries.map((e) => (
        <li key={e.id} className="entry-rise">
          {e.kind === "phase" ? (
            <p className="flex items-center gap-2 py-1 text-xs text-muted">
              <SubagentTag subagent={e.subagent} />
              {e.label}
            </p>
          ) : e.kind === "plan" ? (
            <p className="border-l-2 border-accent py-1 pl-3 font-serif text-sm italic text-ink">
              {e.label}
            </p>
          ) : (
            <div className="rounded-md border border-line bg-surface">
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <Chip status={e.status} />
                <SubagentTag subagent={e.subagent} />
                <code className="font-mono text-xs text-ink">{e.label}</code>
                <span className="ml-auto text-xs text-muted">{open === e.id ? "−" : "+"}</span>
              </button>
              {open === e.id && (
                <div className="border-t border-line px-3 py-2 font-mono text-xs leading-relaxed text-muted">
                  <p className="mb-1 break-all"><span className="text-accent">args</span> {e.args}</p>
                  {e.result && (
                    <p className="max-h-40 overflow-auto break-all">
                      <span className="text-accent">result</span> {e.result.slice(0, 1500)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Typecheck — must pass cleanly now**

Run: `cd POC/web && npx tsc -b --noEmit`
Expected: no errors (this resolves the temporary failure left open at the end of Task 6)

- [ ] **Step 4: Commit**

```bash
git add POC/web/src/App.tsx POC/web/src/components/AgentTimeline.tsx
git commit -m "feat: render grouped, subagent-tagged steps in AgentTimeline"
```

---

### Task 9: Visual redesign — light/dark theme

**Files:**
- Modify: `POC/web/src/index.css` (full current contents already read)
- Modify: `POC/web/src/App.tsx` (add theme toggle)
- Create: `POC/web/src/lib/theme.ts`

**Interfaces:**
- Produces: `getStoredTheme(): "light" | "dark"`, `setStoredTheme(t: "light" | "dark"): void` in `theme.ts`, applying `data-theme` on `document.documentElement` and persisting to `localStorage`. Used by `App.tsx`'s toggle button.

- [ ] **Step 1: Load the frontend-design skill for guidance before touching visual tokens**

Invoke the `frontend-design` skill and read its guidance on typography, color, and avoiding templated defaults before writing the CSS in Step 2.

- [ ] **Step 2: Add a light theme token override and theme helper**

In `POC/web/src/index.css`, keep the existing `@theme` block (it becomes the dark theme — the current dark palette is already deliberate, per the original POC design) and add a light override beneath it:

```css
[data-theme="light"] {
  --color-bg: #f7f5f0;
  --color-surface: #ffffff;
  --color-line: #e2ded4;
  --color-ink: #1c1a16;
  --color-muted: #6b675e;
  --color-accent: #a8791f;
  --color-ok: #4d7a3a;
  --color-bad: #a3392f;
}
```

Create `POC/web/src/lib/theme.ts`:

```ts
export type Theme = "light" | "dark";
const KEY = "poc-theme";

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(KEY, theme);
}
```

- [ ] **Step 3: Wire a theme toggle into `App.tsx`'s header**

Add the import and an effect + toggle button in `POC/web/src/App.tsx`:

```tsx
import { applyTheme, getStoredTheme, type Theme } from "./lib/theme";
```

```tsx
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  useEffect(() => { applyTheme(theme); }, [theme]);
```

In the header, next to the existing "New thread" button:

```tsx
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="ml-2 rounded border border-line px-2 py-0.5 hover:text-ink"
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
```

- [ ] **Step 4: Dispatch a design pass for the remaining visual polish**

Use the Agent tool with `model: "haiku"` and this prompt (this is the "delegate to Haiku" step from the user's original request — scope it tightly to visual polish only, no structural changes):

> "Polish the visual design of the React app in `POC/web/src/`. It already has a light/dark theme token system in `index.css` (`@theme` block = dark, `[data-theme=\"light\"]` override = light) and a working toggle in `App.tsx`. Your job: refine typography rhythm, spacing, and motion across `App.tsx`, `components/AgentTimeline.tsx`, `components/LiveReport.tsx`, `components/RunComposer.tsx`, `components/ThreadSidebar.tsx`, and `index.css` so both themes feel deliberate and distinctive — not a templated default. Do NOT change the 3-pane layout structure (Threads sidebar / Composer+Timeline / Live report), do NOT add new routes or pages, do NOT change any data-fetching or streaming logic. Read the `frontend-design` skill guidance first. When done, run `cd POC/web && npx tsc -b --noEmit` and `npm run build` and confirm both succeed before finishing."

- [ ] **Step 5: Verify the build**

Run: `cd POC/web && npx tsc -b --noEmit && npm run build`
Expected: both succeed with no errors

- [ ] **Step 6: Commit**

```bash
git add POC/web/src/index.css POC/web/src/App.tsx POC/web/src/lib/theme.ts POC/web/src/components/
git commit -m "feat: add light/dark theme toggle and visual polish pass"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd POC/agent && uv run pytest tests/ -v`
Expected: all tests pass (12 total: 5 tool tests + 4 router tests + 3 extract tests)

- [ ] **Step 2: Start the agent server and frontend, run the smoke test**

In one terminal: `cd POC/agent && uv run aegra dev --port 2024`
In another: `cd POC/agent && uv run python ../scripts/smoke.py`
Expected: all four checks print `True`, exit code 0

- [ ] **Step 3: Manual browser check**

Start the frontend (`cd POC/web && npm run dev`), open `http://localhost:5173`, submit "What's winning in Berlin for fitness products?", and confirm:
- The timeline shows three distinct handoff labels (Scout → Analyst → Writer) appearing progressively, not all at once
- Tool-call entries are tagged with the correct subagent
- The final report still renders with `## Verdict`, `## Signals`, `## Reasoning trail`, `## Caveats`
- The theme toggle switches the whole UI between light and dark without a page reload

- [ ] **Step 4: Update `POC/README.md`'s architecture sketch to reflect the new graph**

Replace the graph description in the "Architecture sketch" section (currently describing a single `create_react_agent`) with the supervisor + 3-subagent structure, matching what Task 4 built. Keep the rest of the README (run instructions, deploy steps) unchanged since none of that changed.

- [ ] **Step 5: Commit**

```bash
git add POC/README.md
git commit -m "docs: update architecture sketch for supervisor + subagent graph"
```
