# BossAd — Ad-Insight POC

## 1. What this is

A working end-to-end proof of concept that answers the three architectural bets in [`ARCHITECTURE.md`](../ARCHITECTURE.md): Aegra as the agent runtime (decision §4.1), `useStream` as the only frontend streaming primitive needed (§4.2), a longevity-plus-reach scoring rubric as the signal backbone (§4.5 signals), and a Markdown artifact streamed live in the browser as the report format (§4.7).
The agent receives a free-text question, calls two tools over a 40-ad mock dataset, and streams a structured `## Verdict` report back to the browser in real time.
Nothing here connects to the live Meta Ad Library; replace the mock dataset with the real archive to graduate this POC to production.

### Product mapping

| POC component | ARCHITECTURE.md decision |
|---|---|
| Aegra serves the LangGraph graph | §4.1 — Agent runtime: Aegra |
| `useStream` from `@langchain/langgraph-sdk/react` | §4.2 — Streaming UI: `useStream` alone |
| `compare_products` scores by `days_running` (60 %) + log-reach (40 %) | §4.5 — Longevity + reach as primary signals |
| Agent emits structured Markdown; rendered live with `react-markdown` | §4.7 — MD artifact + live client-side render |

---

## 2. Architecture sketch

```
Browser (Vite :5173)
  └─ useStream (@langchain/langgraph-sdk/react)
       │  HTTP SSE, Agent Protocol
       ▼
Aegra (:2024)           ← aegra.json defines graph + CORS
  └─ LangGraph graph (create_react_agent)
       ├─ AzureChatOpenAI  (deployment = AZURE_OPENAI_DEPLOYMENT)
       ├─ tool: search_ads      → src/agent/data/mock_ads.json  (40 ads, 4 zones)
       └─ tool: compare_products → scores by longevity (60%) + reach (40%)

Postgres (Docker)       ← managed automatically by `aegra dev`
  └─ container name: agent-postgres
       LangGraph checkpoints + thread state
```

---

## 3. Run it

### Prerequisites

- Python 3.12+
- Node 20+
- Docker Desktop running

### First run: fill in `POC/agent/.env`

```bash
cp POC/agent/.env.example POC/agent/.env
```

Open `POC/agent/.env` and replace every value marked `REPLACE_ME` (or the placeholder `https://<your-resource>.openai.azure.com/`) with your real Azure OpenAI credentials:

```
AZURE_OPENAI_API_KEY=<your key>
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-5.4          # or your deployed model name
OPENAI_API_VERSION=2024-10-21

# Postgres — must match the container aegra dev creates
POSTGRES_USER=agent
POSTGRES_PASSWORD=agent_secret
POSTGRES_DB=agent
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
```

> The Postgres variables are **required**. `aegra dev` creates a Docker container named `agent-postgres` with exactly these credentials; if they are missing or wrong the agent server will crash with `InvalidPasswordError` on startup.

### Terminal A — agent server

```bash
cd POC/agent
pip install uv          # one-time; skip if uv is already on PATH
uv sync
uv run aegra dev --port 2024
```

> **Port flag required.** `aegra dev` defaults to port **2026**. The frontend is hardwired to `:2024`; omitting `--port 2024` causes a CORS / connection-refused error in the browser.

Aegra will pull and start the `agent-postgres` Docker container on first run, then print something like:

```
INFO:     Uvicorn running on http://0.0.0.0:2024
```

### Terminal B — frontend

```bash
cd POC/web
npm install
npm run dev
```

Open **http://localhost:5173**.

### Smoke test (optional, requires agent server running)

```bash
cd POC/agent
uv run python ../scripts/smoke.py
```

Expected output ends with exit 0 and prints:

```
tool call observed: True
report contains '## Verdict': True
```

### Agent unit tests

```bash
cd POC/agent
uv run pytest tests/ -v
```

All 36 tests should pass without a running server or real Azure credentials (tools operate on mock data only).

---

## 4. What to try

Three example questions that exercise the full tool chain:

1. **"What fitness products are winning in Berlin right now?"**
   Triggers `search_ads(zone="Berlin", query="fitness")` + `compare_products`.

2. **"Compare supplements vs. sportswear in Paris — which has stronger ad momentum?"**
   Triggers both tools across two product families; the report ranks them by score.

3. **"Is there a dominant advertiser in Amsterdam for home-gym equipment?"**
   Exercises the advertiser field in the evidence block.

**Persistence demo:** start a run, then reload the page mid-stream. The thread ID is saved in `sessionStorage`; `useStream` re-attaches to the live run and the report continues rendering where it left off.

**Transparency demo:** click any tool-call row in the left sidebar (AgentTimeline) to expand the raw input/output the agent passed to that tool.

**Stop button:** the red Stop button in the composer aborts the current run via `stream.stop()`.

---

## 5. What's mock vs. real

| Layer | This POC (mock) | Production path (per ARCHITECTURE.md) |
|---|---|---|
| Ad dataset | 40 hand-crafted JSON records in `src/agent/data/mock_ads.json` | Nightly scheduled pull from Meta Ad Library API → Postgres `ads_archive` schema (§4.5) |
| Zones | Berlin, Paris, Amsterdam, Rome (4) | All EU/UK zones (the only zones the Meta API returns commercial targeting metadata for — see §4.5 geography warning) |
| Authentication | None | JWT auth layer inside Aegra (§4.1) |
| Graph complexity | Single `create_react_agent` node | Multi-node graph with conditional branches A/B/C, subgraph reuse (§4.3) |
| Embeddings / vector search | None | pgvector on the same Postgres instance (§4.5) |
| Observability | None | Langfuse via OTLP — Aegra supports any OTLP backend (§4.8) |
| Hosting | localhost | Railway: Aegra container + Postgres + cron worker; frontend on Vercel (§4.9) |

---

## 6. Troubleshooting

### CORS error in browser console

Symptom: `Access-Control-Allow-Origin` error, or the error banner in the UI reads "Failed to fetch".

Cause: either Aegra is not running, or it is running on the wrong port (default is 2026, not 2024).

Fix: make sure you started the agent server with `uv run aegra dev --port 2024`. The `aegra.json` already allows `http://localhost:5173`; no other config is needed.

### `getaddrinfo failed` / Azure DNS error

Symptom: the agent server starts but immediately crashes with something like:

```
socket.gaierror: [Errno 11001] getaddrinfo failed
```

Cause: `AZURE_OPENAI_ENDPOINT` still contains the placeholder value (e.g. `https://<your-resource>.openai.azure.com/`) — the dummy `.env` was never filled in.

Fix: replace all placeholder values in `POC/agent/.env` with your real Azure credentials, then restart `uv run aegra dev --port 2024`.

### `InvalidPasswordError` / Postgres auth failure

Symptom: Aegra crashes on startup with a Postgres authentication error.

Cause: the `POSTGRES_*` variables in `.env` are missing or do not match the `agent-postgres` container.

Fix: add the exact block shown in §3 First run to `POC/agent/.env`. If you previously ran `aegra dev` with different credentials, remove and recreate the container:

```bash
docker rm -f agent-postgres
```

Then restart `uv run aegra dev --port 2024`; it will recreate the container with the correct credentials.

### Docker not running

Symptom: `aegra dev` fails immediately with a Docker connection error.

Fix: start Docker Desktop and wait for it to report "Engine running", then retry.

### Port 5432 already in use (local Postgres)

Symptom: `aegra dev` fails because port 5432 is occupied by a local Postgres installation.

Options:
- Stop the local Postgres service, or
- Change `POSTGRES_PORT` in `.env` to a free port (e.g. `5433`) and pass the matching flag to `aegra dev` if it accepts one — consult `uv run aegra dev --help`.

### Port 2024 already in use

Symptom: `Error: address already in use :::2024`.

Fix: find and stop the process using port 2024, or pick a different port and update `apiUrl` in `POC/web/src/App.tsx` to match.

### Windows notes

- Run all commands in PowerShell or Git Bash; `uv` works on Windows natively.
- Docker Desktop must be in Linux-container mode (default on Windows).
- If `pip install uv` is blocked by corporate policy, install `uv` via the official installer: `winget install astral-sh.uv`.

---

## 7. Ops Desk — a second showcase page

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
