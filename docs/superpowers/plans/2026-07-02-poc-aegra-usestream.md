# POC: Aegra + useStream Live-Report Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running local demo: Aegra serves a tool-calling LangGraph agent (Azure OpenAI `gpt-5.4`) that researches a mock Meta-ads dataset and streams a Markdown insight report into a React `useStream` UI with a live agent-activity timeline.

**Architecture:** Python agent (`create_react_agent` + 2 tools over bundled JSON data) registered in `aegra.json`, served by `aegra dev` (which auto-starts a Postgres container) at `http://localhost:2024`. React 18 + Vite + TS + Tailwind v4 frontend connects with `useStream` from `@langchain/langgraph-sdk/react` (NOT `@langchain/react` — the classic SDK hook is what Aegra's compatibility explicitly targets via Agent Chat UI). Split UI: activity timeline left, live-rendering Markdown report right.

**Tech Stack:** aegra-cli (PyPI), langgraph, langchain-openai (AzureChatOpenAI), pytest, uv · Vite, React 18, TypeScript, Tailwind v4 (`@tailwindcss/vite`), `@langchain/langgraph-sdk`, react-markdown + remark-gfm.

## Global Constraints

- Everything lives under `POC/` in the repo root (`POC/agent`, `POC/web`, `POC/README.md`).
- Python 3.12+ (machine has 3.13), Node 22, Docker Desktop running. Windows host — all commands must work in Git Bash and/or PowerShell; note shell where it matters.
- LLM env vars (exact names): `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` (value: `gpt-5.4`), `OPENAI_API_VERSION` (default `2024-10-21`). Agent must fail fast with a clear message listing missing vars.
- Frontend hook: `useStream` from `@langchain/langgraph-sdk/react`. Do not use `@langchain/react` in this POC.
- Aegra server URL `http://localhost:2024`; Vite dev server `http://localhost:5173`; CORS for 5173 configured in `aegra.json`.
- No auth (Aegra dev mode). No real Meta API calls anywhere.
- Design quality bar: distinctive dark editorial aesthetic (tokens specified in Task 4) — not default-Tailwind generic. Read the `frontend-design:frontend-design` skill before Task 4 if available.
- Commit after every task (conventional commits, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer).

---

### Task 1: Agent project — data, tools (TDD), graph, Aegra config

**Files:**
- Create: `POC/agent/pyproject.toml`
- Create: `POC/agent/aegra.json`
- Create: `POC/agent/.env.example`
- Create: `POC/agent/.gitignore`
- Create: `POC/agent/src/agent/__init__.py` (empty)
- Create: `POC/agent/src/agent/data/mock_ads.json`
- Create: `POC/agent/src/agent/tools.py`
- Create: `POC/agent/src/agent/prompts.py`
- Create: `POC/agent/src/agent/graph.py`
- Test: `POC/agent/tests/test_tools.py`

**Interfaces:**
- Produces: `graph` (compiled LangGraph) importable as `./src/agent/graph.py:graph`, registered under assistant id **`agent`**. Tools: `search_ads(zone: str, query: str) -> str` (JSON string of matching ads), `compare_products(product_names: list[str], zone: str) -> str` (JSON string of scored ranking). Pure helpers `_filter_ads(ads, zone, query)` and `_score_products(ads, product_names, zone)` for tests.

- [ ] **Step 1: Author `pyproject.toml`, `aegra.json`, `.env.example`, `.gitignore`**

`POC/agent/pyproject.toml`:
```toml
[project]
name = "bossad-poc-agent"
version = "0.1.0"
description = "BossAd POC: mock ad-insight agent served by Aegra"
requires-python = ">=3.12"
dependencies = [
    "aegra-cli>=0.1",
    "langgraph>=1.0",
    "langchain-openai>=1.0",
    "python-dotenv>=1.0",
]

[dependency-groups]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
pythonpath = ["src"]
```
(If `uv sync` reports a version-solve failure on `aegra-cli`/`langgraph`/`langchain-openai` floors, relax the floor to what PyPI offers — check with `uv pip index` or pypi.org — rather than pinning blindly.)

`POC/agent/aegra.json`:
```json
{
  "graphs": {
    "agent": "./src/agent/graph.py:graph"
  },
  "http": {
    "cors": {
      "allow_origins": ["http://localhost:5173"],
      "allow_credentials": true
    }
  }
}
```

`POC/agent/.env.example`:
```bash
# Azure OpenAI — all four required (OPENAI_API_VERSION has a default in code)
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
OPENAI_API_VERSION=2024-10-21
```

`POC/agent/.gitignore`:
```
.env
.venv/
__pycache__/
*.pyc
```

- [ ] **Step 2: Author the mock dataset**

`POC/agent/src/agent/data/mock_ads.json` — a JSON array of **exactly 40** ad objects. Schema per record:
```json
{
  "ad_id": "ad_0001",
  "zone": "Berlin",
  "product": "Resistance Band Set",
  "category": "fitness",
  "days_running": 187,
  "eu_total_reach": 942000,
  "gender_target": "All",
  "advertiser": "FlexKit GmbH",
  "creative_body": "Train anywhere. 5 bands, lifetime warranty — join 40,000 Berliners who ditched the gym."
}
```
Data requirements (author by hand, deterministic, realistic — this is demo content the user will read on screen):
- Zones: `Berlin`, `Paris`, `Madrid`, `Amsterdam` (10 ads each).
- Categories spread across: fitness, kitchen, beauty, pet, home-office, outdoor.
- `days_running` between 3 and 420 with a deliberate story per zone: each zone gets 2–3 long-runners (>150 days, high reach — the "winners"), several mid, and a few short-lived duds (<14 days, low reach).
- `eu_total_reach` between 8_000 and 2_400_000, roughly correlated with `days_running` (winners have both).
- `gender_target` ∈ `All` / `Women` / `Men` with some variety.
- `creative_body`: one punchy sentence each, distinct voice per advertiser — no lorem ipsum, no repeated templates.

- [ ] **Step 3: Write the failing tests**

`POC/agent/tests/test_tools.py`:
```python
import json
from agent.tools import _filter_ads, _score_products, search_ads, ADS


def test_dataset_loads_40_ads():
    assert len(ADS) == 40
    required = {"ad_id", "zone", "product", "category", "days_running",
                "eu_total_reach", "gender_target", "advertiser", "creative_body"}
    assert all(required <= set(ad) for ad in ADS)


def test_filter_by_zone_only_returns_that_zone():
    result = _filter_ads(ADS, zone="Berlin", query="")
    assert result, "Berlin should have ads"
    assert all(ad["zone"] == "Berlin" for ad in result)


def test_filter_query_matches_product_category_and_creative():
    result = _filter_ads(ADS, zone="Berlin", query="fitness")
    assert result
    assert all(
        "fitness" in (ad["product"] + " " + ad["category"] + " " + ad["creative_body"]).lower()
        for ad in result
    )


def test_filter_unknown_zone_returns_empty():
    assert _filter_ads(ADS, zone="Atlantis", query="") == []


def test_score_products_ranks_longevity_and_reach():
    ads = [
        {"product": "A", "zone": "Berlin", "days_running": 300, "eu_total_reach": 2_000_000},
        {"product": "B", "zone": "Berlin", "days_running": 10, "eu_total_reach": 9_000},
    ]
    ranked = _score_products(ads, ["A", "B"], zone="Berlin")
    assert ranked[0]["product"] == "A"
    assert ranked[0]["score"] > ranked[1]["score"]
    assert 0 <= ranked[1]["score"] <= ranked[0]["score"] <= 100


def test_search_ads_tool_returns_json_string():
    out = search_ads.invoke({"zone": "Berlin", "query": "fitness"})
    parsed = json.loads(out)
    assert isinstance(parsed, list)
```

- [ ] **Step 4: Run tests, verify they fail**

Run (in `POC/agent`, after `uv sync`): `uv run pytest tests/ -v`
Expected: FAIL / collection error — `agent.tools` does not exist.

- [ ] **Step 5: Implement `tools.py`**

`POC/agent/src/agent/tools.py`:
```python
"""Tools over the bundled mock Meta-ads dataset. No network calls."""
import json
import math
from pathlib import Path

from langchain_core.tools import tool

_DATA_PATH = Path(__file__).parent / "data" / "mock_ads.json"
ADS: list[dict] = json.loads(_DATA_PATH.read_text(encoding="utf-8"))

_MAX_DAYS = 420
_MAX_LOG_REACH = math.log10(2_400_000)


def _filter_ads(ads: list[dict], zone: str, query: str) -> list[dict]:
    zone_l = zone.strip().lower()
    query_l = query.strip().lower()
    out = []
    for ad in ads:
        if ad["zone"].lower() != zone_l:
            continue
        haystack = f'{ad["product"]} {ad["category"]} {ad["creative_body"]}'.lower()
        if query_l and query_l not in haystack:
            continue
        out.append(ad)
    return sorted(out, key=lambda a: a["days_running"], reverse=True)


def _score_products(ads: list[dict], product_names: list[str], zone: str) -> list[dict]:
    """Score 0-100: 60% longevity (days_running), 40% reach (log-scaled).

    Longevity dominates because sustained spend is the strongest public
    signal an ad is profitable — same rubric as the production design.
    """
    wanted = {p.strip().lower() for p in product_names}
    zone_l = zone.strip().lower()
    ranked = []
    for name in wanted:
        matches = [a for a in ads
                   if a["zone"].lower() == zone_l and name in a["product"].lower()]
        if not matches:
            ranked.append({"product": name, "score": 0, "verdict": "no ads found in zone",
                           "evidence": []})
            continue
        best = max(matches, key=lambda a: a["days_running"])
        longevity = min(best["days_running"] / _MAX_DAYS, 1.0)
        reach = min(math.log10(max(best["eu_total_reach"], 1)) / _MAX_LOG_REACH, 1.0)
        ranked.append({
            "product": best["product"],
            "score": round((0.6 * longevity + 0.4 * reach) * 100),
            "verdict": f'{best["days_running"]} days running, reach {best["eu_total_reach"]:,}',
            "evidence": [{"ad_id": a["ad_id"], "days_running": a["days_running"],
                          "eu_total_reach": a["eu_total_reach"],
                          "advertiser": a["advertiser"]} for a in matches],
        })
    return sorted(ranked, key=lambda r: r["score"], reverse=True)


@tool
def search_ads(zone: str, query: str) -> str:
    """Search the ad archive for a zone. `query` matches product, category or
    creative text; pass "" to list everything in the zone. Returns JSON."""
    return json.dumps(_filter_ads(ADS, zone, query), ensure_ascii=False)


@tool
def compare_products(product_names: list[str], zone: str) -> str:
    """Score candidate products in a zone by ad longevity (60%) and reach (40%).
    Returns a JSON ranking with per-product evidence."""
    return json.dumps(_score_products(ADS, product_names, zone), ensure_ascii=False)
```

- [ ] **Step 6: Run tests, verify all pass**

Run: `uv run pytest tests/ -v` → Expected: 6 passed.

- [ ] **Step 7: Implement `prompts.py` and `graph.py`**

`POC/agent/src/agent/prompts.py`:
```python
SYSTEM_PROMPT = """You are the BossAd insight agent (proof-of-concept). You analyze a \
local archive of Meta ads to answer product questions for a target zone.

Workflow — follow it strictly:
1. Open with ONE short sentence stating your research plan (no heading).
2. Use `search_ads` to explore the zone (start broad with query="", then narrow). \
Use `compare_products` to score candidates you identified.
3. Ground EVERY claim in tool results only. Never invent ads, numbers or advertisers. \
If the archive has nothing relevant, say so honestly.

Then write the final answer as a Markdown report with EXACTLY these sections:
# <Punchy report title>
## Verdict
One bolded winner (or honest no-winner/greenfield call) and a 2-sentence rationale.
## Signals
A GFM table: Product | Days running | EU reach | Score | Reading.
## Reasoning trail
Numbered steps: what you searched, what you found, what you ruled out and why.
## Caveats
Data window, mock-data notice, what production data would add.

Rules: cite ad_ids inline like (ad_0007). Keep the whole report under 450 words. \
The report must stand alone — no references to "the tool" or this conversation."""
```

`POC/agent/src/agent/graph.py`:
```python
"""BossAd POC graph — served by Aegra as assistant id `agent`."""
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

from langchain_openai import AzureChatOpenAI
from langgraph.prebuilt import create_react_agent

from agent.prompts import SYSTEM_PROMPT
from agent.tools import compare_products, search_ads

model = AzureChatOpenAI(
    azure_deployment=os.environ["AZURE_OPENAI_DEPLOYMENT"],
    api_version=os.environ.get("OPENAI_API_VERSION", "2024-10-21"),
    temperature=0.3,
    streaming=True,
)

graph = create_react_agent(model, tools=[search_ads, compare_products], prompt=SYSTEM_PROMPT)
```
Note: `create_react_agent` import path — if `langgraph.prebuilt` moved in langgraph 1.x, check `from langgraph.prebuilt import create_react_agent` vs `langchain.agents.create_agent`; use whichever the installed version exposes (verify with `uv run python -c "from langgraph.prebuilt import create_react_agent"`). If using `create_agent` from langchain, keyword is `system_prompt=`.
Note: `dependencies` in aegra.json isn't needed because `pyproject.toml` makes `agent` an installed package via `pythonpath`/src layout — BUT if Aegra fails to import `agent.tools`, add `"dependencies": ["./src"]` to `aegra.json`.

- [ ] **Step 8: Sanity-import and commit**

Run: `uv run python -c "from agent.graph import graph; print(type(graph).__name__)"` (with a filled `.env`; if the user's key isn't available yet, set dummy values — import must still succeed since no API call happens at import time).
Expected: prints a Pregel/CompiledStateGraph class name.

```bash
git add POC/agent
git commit -m "feat(poc): agent project — mock ads dataset, scored tools (TDD), Aegra graph"
```

---

### Task 2: Boot Aegra + SDK smoke test

**Files:**
- Create: `POC/scripts/smoke.py`

**Interfaces:**
- Consumes: assistant id `agent` on `http://localhost:2024` (Task 1).
- Produces: a verified, running Aegra server; smoke script exit 0 = healthy.

- [ ] **Step 1: Install deps and start the server**

In `POC/agent` (PowerShell or Git Bash; Docker Desktop must be running):
```bash
pip install uv          # if uv not already installed
uv sync
uv run aegra dev
```
Expected output: Postgres container starts, migrations apply, then `Uvicorn running on http://0.0.0.0:2024` (or similar). Leave running (background it: use `run_in_background`).
Troubleshooting: if the Postgres container conflicts on port 5432 with the local PostgreSQL 18 install (this machine has one in PATH), configure the Aegra Postgres container to another host port per `aegra dev` options (`aegra dev --help`) or stop the local service; document whatever was needed in the README.

- [ ] **Step 2: Verify API surface**

Run: `curl -s http://localhost:2024/docs -o /dev/null -w "%{http_code}"` → Expected: `200`.
Also: `curl -s -X POST http://localhost:2024/threads -H "Content-Type: application/json" -d "{}"` → Expected: JSON with `thread_id`.

- [ ] **Step 3: Write the smoke script**

`POC/scripts/smoke.py`:
```python
"""End-to-end smoke test: create thread, stream a run, assert tool call + report.
Run from POC/agent:  uv run python ../scripts/smoke.py
Exit 0 on success, 1 on failure.
"""
import asyncio
import sys

from langgraph_sdk import get_client


async def main() -> int:
    client = get_client(url="http://localhost:2024")
    thread = await client.threads.create()
    saw_tool_call = False
    final_text = ""

    async for chunk in client.runs.stream(
        thread_id=thread["thread_id"],
        assistant_id="agent",
        input={"messages": [{"type": "human",
                             "content": "What's winning in Berlin for fitness products?"}]},
        stream_mode="messages-tuple",
    ):
        if chunk.event.startswith("messages"):
            msg = chunk.data[0] if isinstance(chunk.data, list) else chunk.data
            if msg.get("tool_calls") or msg.get("tool_call_chunks"):
                saw_tool_call = True
            if msg.get("type") in ("ai", "AIMessageChunk") and isinstance(msg.get("content"), str):
                final_text += msg["content"]

    ok_tool = saw_tool_call
    ok_report = "## Verdict" in final_text
    print(f"tool call observed: {ok_tool}")
    print(f"report contains '## Verdict': {ok_report}")
    print(f"---\n{final_text[:600]}\n---")
    return 0 if (ok_tool and ok_report) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```
(If `stream_mode="messages-tuple"` yields a different chunk shape against Aegra, adapt the event parsing — the assertion targets are what matter: at least one tool call observed, final text contains `## Verdict`. Check Aegra's streaming guide at docs.aegra.dev/guides/streaming if needed.)

- [ ] **Step 4: Run smoke test (requires real Azure key in `POC/agent/.env`)**

Run: `cd POC/agent && uv run python ../scripts/smoke.py`
Expected: both checks `True`, exit 0. If the Azure key is not yet provided, pause and ask the user to fill `POC/agent/.env` — this step cannot be faked.

- [ ] **Step 5: Commit**

```bash
git add POC/scripts/smoke.py
git commit -m "feat(poc): aegra boot verified + SDK streaming smoke test"
```

---

### Task 3: Web scaffold — Vite + useStream wired end-to-end (ugly but streaming)

**Files:**
- Create: `POC/web/` (Vite scaffold: `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/index.css`)
- Create: `POC/web/src/App.tsx`
- Create: `POC/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: Aegra at `http://localhost:2024`, assistant `agent`.
- Produces: `useAdAgentStream()` — wrapper returning `{ stream, timeline, report }`; `deriveTimeline(messages): TimelineEntry[]` and `deriveReport(messages): string` in `lib/messages.ts` used by Task 4 components.
  - `type TimelineEntry = { id: string; kind: "plan" | "tool"; label: string; args?: string; result?: string; status: "running" | "done" }`

- [ ] **Step 1: Scaffold**

```bash
cd POC && npm create vite@latest web -- --template react-ts
cd web && npm install
npm install @langchain/langgraph-sdk @langchain/core react-markdown remark-gfm
npm install -D tailwindcss @tailwindcss/vite
```
Add the Tailwind v4 plugin to `vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```
Replace `src/index.css` contents with just `@import "tailwindcss";` for now (Task 4 replaces it with the design system). Delete Vite demo cruft (`App.css`, logo assets, demo markup).

- [ ] **Step 2: Implement message-derivation helpers**

`POC/web/src/lib/messages.ts`:
```ts
import type { Message } from "@langchain/langgraph-sdk";

export type TimelineEntry = {
  id: string;
  kind: "plan" | "tool";
  label: string;
  args?: string;
  result?: string;
  status: "running" | "done";
};

const asText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
      : "";

/** Tool calls (with matched results) + the agent's one-line plan, in order. */
export function deriveTimeline(messages: Message[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const resultsByCallId = new Map<string, string>();
  for (const m of messages) {
    if (m.type === "tool" && (m as any).tool_call_id) {
      resultsByCallId.set((m as any).tool_call_id, asText(m.content));
    }
  }
  let planEmitted = false;
  for (const m of messages) {
    if (m.type !== "ai") continue;
    const toolCalls = (m as any).tool_calls ?? [];
    const text = asText(m.content).trim();
    if (!planEmitted && text && toolCalls.length > 0) {
      entries.push({ id: `${m.id}-plan`, kind: "plan", label: text, status: "done" });
      planEmitted = true;
    }
    for (const tc of toolCalls) {
      const result = tc.id ? resultsByCallId.get(tc.id) : undefined;
      entries.push({
        id: tc.id ?? `${m.id}-${tc.name}`,
        kind: "tool",
        label: tc.name,
        args: JSON.stringify(tc.args),
        result,
        status: result !== undefined ? "done" : "running",
      });
    }
  }
  return entries;
}

/** The report = text of the last AI message that has content and no tool calls. */
export function deriveReport(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type !== "ai") continue;
    const toolCalls = (m as any).tool_calls ?? [];
    const text = asText(m.content);
    if (text.trim() && toolCalls.length === 0) return text;
  }
  return "";
}
```

- [ ] **Step 3: Minimal `App.tsx` proving the stream**

```tsx
import { useStream } from "@langchain/langgraph-sdk/react";
import { deriveReport, deriveTimeline } from "./lib/messages";

export default function App() {
  const stream = useStream({
    apiUrl: "http://localhost:2024",
    assistantId: "agent",
    messagesKey: "messages",
  });
  const timeline = deriveTimeline(stream.messages);
  const report = deriveReport(stream.messages);

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q") as string;
          if (q.trim()) stream.submit({ messages: [{ type: "human", content: q }] });
        }}
      >
        <input name="q" defaultValue="What's winning in Berlin for fitness products?" size={60} />
        <button type="submit" disabled={stream.isLoading}>Run</button>
      </form>
      <pre>{JSON.stringify(timeline, null, 2)}</pre>
      <pre>{report}</pre>
    </main>
  );
}
```

- [ ] **Step 4: Verify streaming end-to-end in a real browser**

With Aegra running: `npm run dev` → open `http://localhost:5173`, submit the default question. Expected: timeline JSON grows as tool calls happen; report text accumulates token-by-token. If the browser console shows CORS errors, fix `aegra.json` `http.cors` and restart Aegra. Use browser automation or ask the user to confirm visually if no browser tooling available.

- [ ] **Step 5: Commit**

```bash
git add POC/web
git commit -m "feat(poc): Vite + useStream wired to Aegra, raw streaming proven"
```

---

### Task 4: The real UI — design system, timeline, live report

**Files:**
- Modify: `POC/web/src/index.css` (design tokens)
- Modify: `POC/web/index.html` (fonts, title)
- Modify: `POC/web/src/App.tsx` (layout + state orchestration)
- Create: `POC/web/src/components/RunComposer.tsx`
- Create: `POC/web/src/components/AgentTimeline.tsx`
- Create: `POC/web/src/components/LiveReport.tsx`

**Interfaces:**
- Consumes: `deriveTimeline` / `deriveReport` / `TimelineEntry` from Task 3; `stream` object from `useStream` (`messages`, `isLoading`, `error`, `stop()`, `submit()`).

**Design direction (binding, not a suggestion):** dark editorial "intelligence briefing" aesthetic. If the `frontend-design:frontend-design` skill is available, read it first; these tokens still apply:
- Background `#0B0D10`, surface `#12151A`, hairline borders `#232830`, primary text `#E8E6E1`, muted `#8A9099`, single accent `#D4A843` (amber — used sparingly: status chips, table header rule, links), success `#7FB069`, error `#C4554D`.
- Fonts (load in `index.html` via Google Fonts): **Newsreader** (serif, 500/600, optical sizing) for the report headings and app wordmark; **Inter** for UI text; **JetBrains Mono** for tool args/results and data. No font-size below 12px.
- Layout: fixed left rail 380px (composer + timeline, independently scrollable), right pane fluid (report, max-width ~68ch, generous whitespace). Top bar: wordmark "BossAd / Insight POC" + thread status dot (idle/running/error).
- Motion: report pane autoscrolls only while user is at bottom; timeline entries fade/slide in (~150ms ease-out); running tool chip gets a subtle pulse. No spinners anywhere — progress IS the UI.
- Empty state (before first run): centered serif line "Ask the archive." + three example-question buttons that prefill the composer.

- [ ] **Step 1: Design tokens + fonts**

`POC/web/index.html` head additions:
```html
<title>BossAd · Insight POC</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

`POC/web/src/index.css`:
```css
@import "tailwindcss";

@theme {
  --color-bg: #0b0d10;
  --color-surface: #12151a;
  --color-line: #232830;
  --color-ink: #e8e6e1;
  --color-muted: #8a9099;
  --color-accent: #d4a843;
  --color-ok: #7fb069;
  --color-bad: #c4554d;
  --font-serif: "Newsreader", ui-serif, serif;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

html { background: var(--color-bg); color: var(--color-ink); }
body { font-family: var(--font-sans); }

@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.entry-rise { animation: rise 150ms ease-out; }
@keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.pulse { animation: pulse-dot 1.2s ease-in-out infinite; }

/* Report typography (react-markdown output) */
.report { max-width: 68ch; }
.report h1 { font-family: var(--font-serif); font-size: 2rem; font-weight: 600; line-height: 1.15; margin: 0 0 1rem; }
.report h2 { font-family: var(--font-serif); font-size: 1.25rem; font-weight: 600; margin: 2rem 0 .6rem; padding-bottom: .35rem; border-bottom: 1px solid var(--color-line); }
.report p, .report li { line-height: 1.65; color: var(--color-ink); }
.report strong { color: var(--color-accent); font-weight: 600; }
.report table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: .8rem; margin: 1rem 0; }
.report th { text-align: left; color: var(--color-muted); font-weight: 500; border-bottom: 1px solid var(--color-accent); padding: .4rem .6rem; }
.report td { border-bottom: 1px solid var(--color-line); padding: .45rem .6rem; }
.report ol { padding-left: 1.2rem; }
.report code { font-family: var(--font-mono); font-size: .85em; color: var(--color-accent); }
```

- [ ] **Step 2: `RunComposer.tsx`**

```tsx
import { useState } from "react";

const EXAMPLES = [
  "What's winning in Berlin for fitness products?",
  "Compare kitchen gadgets vs pet products in Paris.",
  "I have no product ideas — what's hot in Madrid?",
];

export function RunComposer(props: {
  isLoading: boolean;
  onSubmit: (q: string) => void;
  onStop: () => void;
  prefill: string;
  setPrefill: (v: string) => void;
}) {
  const [value, setValue] = useState("");
  const text = props.prefill || value;
  return (
    <div className="border-b border-line p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !props.isLoading) {
            props.onSubmit(text.trim());
            props.setPrefill("");
            setValue("");
          }
        }}
      >
        <textarea
          value={text}
          onChange={(e) => { props.setPrefill(""); setValue(e.target.value); }}
          rows={3}
          placeholder="Ask the archive…"
          className="w-full resize-none rounded-md border border-line bg-surface p-3 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-muted">zone-scoped · mock archive · 40 ads</p>
          {props.isLoading ? (
            <button type="button" onClick={props.onStop}
              className="rounded-md border border-bad px-4 py-1.5 text-sm text-bad hover:bg-bad/10">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!text.trim()}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-bg disabled:opacity-40">
              Run analysis
            </button>
          )}
        </div>
      </form>
      {EXAMPLES.map((q) => (
        <button key={q} onClick={() => props.setPrefill(q)}
          className="mt-1.5 block w-full truncate rounded px-2 py-1 text-left text-xs text-muted hover:bg-surface hover:text-ink">
          ↳ {q}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `AgentTimeline.tsx`**

```tsx
import { useState } from "react";
import type { TimelineEntry } from "../lib/messages";

function Chip({ status }: { status: TimelineEntry["status"] }) {
  return status === "running" ? (
    <span className="pulse inline-block size-2 rounded-full bg-accent" title="running" />
  ) : (
    <span className="inline-block size-2 rounded-full bg-ok" title="done" />
  );
}

export function AgentTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (entries.length === 0)
    return <p className="p-5 text-xs text-muted">Agent activity will appear here.</p>;
  return (
    <ol className="space-y-1 p-4">
      {entries.map((e) => (
        <li key={e.id} className="entry-rise">
          {e.kind === "plan" ? (
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
                <code className="font-mono text-xs text-ink">{e.label}</code>
                <span className="ml-auto text-xs text-muted">{open === e.id ? "−" : "+"}</span>
              </button>
              {open === e.id && (
                <div className="border-t border-line px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
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

- [ ] **Step 4: `LiveReport.tsx` (autoscroll only when pinned to bottom)**

```tsx
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function LiveReport({ markdown, isLoading }: { markdown: string; isLoading: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [markdown]);

  if (!markdown && !isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-serif text-2xl italic text-muted">Ask the archive.</p>
      </div>
    );
  }
  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className="h-full overflow-y-auto px-10 py-8"
    >
      <article className="report">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        {isLoading && <span className="pulse ml-1 inline-block h-4 w-2 bg-accent align-text-bottom" />}
      </article>
    </div>
  );
}
```

- [ ] **Step 5: Final `App.tsx` — layout, status, error banner, thread reattach**

```tsx
import { useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { RunComposer } from "./components/RunComposer";
import { AgentTimeline } from "./components/AgentTimeline";
import { LiveReport } from "./components/LiveReport";
import { deriveReport, deriveTimeline } from "./lib/messages";

export default function App() {
  const [threadId, setThreadId] = useState<string | null>(
    () => sessionStorage.getItem("poc-thread"),
  );
  const [prefill, setPrefill] = useState("");
  const stream = useStream({
    apiUrl: "http://localhost:2024",
    assistantId: "agent",
    messagesKey: "messages",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      if (id) sessionStorage.setItem("poc-thread", id);
    },
    reconnectOnMount: true,
  });

  const timeline = deriveTimeline(stream.messages);
  const report = deriveReport(stream.messages);
  const status = stream.error ? "error" : stream.isLoading ? "running" : "idle";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h1 className="font-serif text-lg font-semibold">
          BossAd <span className="text-muted">/ Insight POC</span>
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={`size-2 rounded-full ${
            status === "running" ? "pulse bg-accent" : status === "error" ? "bg-bad" : "bg-ok"
          }`} />
          {status}
          <button
            onClick={() => { sessionStorage.removeItem("poc-thread"); setThreadId(null); }}
            className="ml-3 rounded border border-line px-2 py-0.5 hover:text-ink"
          >
            New thread
          </button>
        </div>
      </header>

      {stream.error != null && (
        <div className="border-b border-bad bg-bad/10 px-5 py-2 text-sm text-bad">
          {String((stream.error as Error).message ?? stream.error)} — is Aegra running on :2024?
        </div>
      )}

      <div className="flex min-h-0 flex-1">
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
    </div>
  );
}
```
Note: if `reconnectOnMount` isn't a valid option in the installed `@langchain/langgraph-sdk` version, remove it — thread reattach still works via `threadId` (state reloads; joining a mid-flight stream is a bonus, verify against the SDK version's docs).

- [ ] **Step 6: Verify visually + TypeScript build**

Run: `npm run build` → Expected: no TS errors. Then `npm run dev`, run all three example questions. Check: plan line appears in timeline; tool chips pulse then turn green; expanding a tool shows args/result; report streams with serif headings and the GFM signals table renders as a styled table; Stop works mid-run; reloading mid-run reattaches to the thread; "New thread" resets.

- [ ] **Step 7: Commit**

```bash
git add POC/web
git commit -m "feat(poc): editorial dark UI — live timeline + streaming markdown report"
```

---

### Task 5: Documentation + final end-to-end verification

**Files:**
- Create: `POC/README.md`

- [ ] **Step 1: Write `POC/README.md`** with these sections (real content, no placeholders):
1. **What this is** — 3 sentences + the product mapping (this POC ↔ ARCHITECTURE.md: Aegra = runtime decision §4.1, useStream = §4.2, longevity+reach scoring = §4.5 signals, MD-report-streaming = §4.7).
2. **Architecture sketch** — small ASCII diagram: browser (Vite :5173, useStream) → Aegra (:2024, Agent Protocol, SSE) → LangGraph agent (AzureChatOpenAI gpt-5.4 + 2 tools) → mock_ads.json; Postgres (Docker) for threads/checkpoints.
3. **Run it** — the exact command sequence:
   ```
   # 1. agent  (terminal A)
   cd POC/agent && cp .env.example .env   # fill Azure values
   pip install uv && uv sync && uv run aegra dev
   # 2. web    (terminal B)
   cd POC/web && npm install && npm run dev
   # open http://localhost:5173
   ```
   plus the smoke test command and any Windows/port-5432 caveat discovered in Task 2.
4. **What to try** — the three example questions + "reload the page mid-run" (persistence demo) + "expand a tool call" (transparency demo).
5. **What's mock vs real** — table: mock (dataset, no auth, single graph) vs real path (per ARCHITECTURE.md).
6. **Troubleshooting** — CORS, missing .env, Docker not running, port conflicts.

- [ ] **Step 2: Full clean-slate verification**

Kill everything, then follow the README verbatim from scratch (fresh terminals). Expected: working demo purely from documented steps. Fix any README drift found.

- [ ] **Step 3: Commit**

```bash
git add POC/README.md
git commit -m "docs(poc): runbook, architecture sketch, prod mapping"
```

---

## Self-review notes (done at planning time)

- Spec coverage: agent+tools+data (Task 1), Aegra boot+smoke (Task 2), useStream wiring (Task 3), UI/design/error/stop/reattach (Task 4), README (Task 5). Spec's optional standalone docker-compose.yml dropped — `aegra dev` manages the Postgres container itself (verified in Aegra quickstart docs 2026-07-02); README documents this instead.
- Known uncertainty flagged inline: `create_react_agent` import path on langgraph 1.x; `messages-tuple` chunk shape vs Aegra; `reconnectOnMount` option availability. Each has a written fallback.
- Types consistent: `TimelineEntry` defined once (Task 3), consumed in Task 4; `deriveTimeline`/`deriveReport` signatures match usage.
