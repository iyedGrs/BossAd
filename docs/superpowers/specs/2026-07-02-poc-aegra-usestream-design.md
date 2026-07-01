# POC — Aegra + useStream Live-Report Demo (Design Spec)

**Date:** 2026-07-02 · **Status:** Approved by user (Approach A)
**Goal:** See Aegra working end-to-end with a small tool-calling agent and a React `useStream` UI, entirely on free/local infrastructure (only cost: Azure OpenAI tokens). Prod-level code quality and a distinctive UI, inside a `POC/` folder, documented.

## What we're building

A scaled-down preview of the BossAd product pattern (see `ARCHITECTURE.md`): an agent that plans, calls tools over a mock Meta-ads dataset, and **writes a Markdown insight report that streams live into the UI**. Not a chat app — an agent-drives-UI experience: activity timeline on the left, report writing itself on the right.

## Constraints & environment (verified 2026-07-02)

- Windows 11, Docker 28 + Compose v2, Node 22, Python 3.13. All local, $0 infra.
- LLM: **Azure OpenAI, deployment `gpt-5.4`** via `AzureChatOpenAI` (langchain-openai). Config from `.env` (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `OPENAI_API_VERSION`). Fail fast with a clear message if missing.
- Aegra (Apache-2.0, github.com/aegra/aegra) serves the graph at `http://localhost:2024`; Postgres via Docker Compose for threads/runs/checkpoints. Dev no-auth mode.
- Frontend: React 18 + Vite + TypeScript + Tailwind, `useStream` from `@langchain/react` (fall back to `@langchain/langgraph-sdk/react` if the new package has issues against Aegra — implementer verifies against Aegra's docs).

## Components

```
POC/
├── agent/                          # Python LangGraph app served by Aegra
│   ├── src/agent/graph.py          # agent w/ AzureChatOpenAI + tools; emits MD report
│   ├── src/agent/tools.py          # search_ads(zone, query), compare_products(...)
│   ├── src/agent/data/mock_ads.json# ~40 realistic fake ads: id, zone, product, category,
│   │                               #   days_running, eu_total_reach, gender_target, creative_body
│   ├── aegra.json                  # graph registration for Aegra
│   ├── pyproject.toml / requirements
│   └── .env.example
├── web/                            # Vite React TS app
│   └── src/
│       ├── App.tsx                 # useStream(apiUrl: localhost:2024, assistantId)
│       ├── components/RunComposer.tsx   # zone + product-question input, submit / stop
│       ├── components/AgentTimeline.tsx # live tool calls: status chip, expandable args/result
│       └── components/LiveReport.tsx    # streaming MD → react-markdown (+remark-gfm), autoscroll
├── docker-compose.yml              # postgres:16 (+ optionally aegra container)
├── scripts/smoke.py or .ts         # health check + SDK-created run, asserts stream events
└── README.md                       # 3-command runbook, architecture sketch, prod mapping
```

## Agent behavior

Input: free-text ask (e.g., "What's winning in Berlin for fitness products?"). The agent:
1. States a short plan (visible in stream).
2. Calls `search_ads` (filters mock dataset by zone/keywords) — possibly multiple times.
3. Calls `compare_products` (scores by longevity `days_running` + `eu_total_reach` — the same signals as prod).
4. Writes a structured Markdown report (verdict, signal table, reasoning, honest data-freshness note) streamed token-by-token.

System prompt keeps it grounded in tool results only. Recursion/step caps set so a run finishes in ~30–90s.

## UI / UX

Split layout. Left rail: run composer + agent activity timeline (plan, each tool call appears live with running/done chip, expandable JSON args/results). Right pane (dominant): the report rendering live as Markdown. Distinctive dark editorial aesthetic (frontend-design skill applies during implementation — intentional typography, not template Tailwind defaults). Extras: stop button, error banner on stream failure, reattach-to-running-thread on reload (thread id in sessionStorage) to demo Aegra's background-run resilience.

## Error handling

- Agent startup validates Azure env vars → clear exit message.
- UI: `onError` → dismissible banner; stop → `stream.stop()`; empty input disabled.
- Smoke script exits non-zero on failure.

## Verification

1. `docker compose up -d` (Postgres) → 2. run Aegra (agent dir) → 3. `npm run dev` (web). Smoke script passes; visual check: tool calls appear live, report streams, reload mid-run reattaches.

## Out of scope

Real Meta API, auth, deployment, tests beyond smoke script, premium features (HITL/forks) — though the stack supports them.
