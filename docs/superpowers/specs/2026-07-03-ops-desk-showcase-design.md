# Ops Desk — Agent/UI Showcase Page (Design Spec)

**Date:** 2026-07-03 · **Status:** Approved by user
**Goal:** A second page in the POC web app that showcases interactive LangGraph agent/UI techniques — a live "thinking" stream, tool calls revealed one-by-one, human-in-the-loop (HITL) approval of risky actions, live skill/persona tagging, and checkpoint-based time-travel/branching — on a hand-rolled (non-`create_react_agent`) graph. Not Ad-related; a standalone showcase domain.

## What we're building

A chat-first page, **"Ops Desk"**, where the user talks to a mock infra/ops assistant. The assistant investigates a small fictional service fleet using read-only tools, narrates its reasoning via a dedicated `think` tool, and must get human approval before any risky action (restart/scale/rollback). A live "Ops Board" panel shows the fleet's real state, updating the instant an approved action lands — visible proof the agent's actions had effect. Past turns can be edited and replayed via LangGraph's checkpoint branching, exposed through `useStream`'s built-in history/branch API.

This sits alongside the existing Ad Insight page in the same POC web app (shared nav, shared Aegra server), not a separate mini-project.

## Constraints & environment

Same stack as the existing POC: Windows 11, Aegra @ `localhost:2024`, Postgres via Docker Compose, Azure OpenAI (`ChatOpenAI` via `langchain-openai`, same deployment/env vars), Vite + React 19 + TypeScript + Tailwind v4, `useStream` from `@langchain/langgraph-sdk/react`. No new infrastructure.

`create_react_agent` / LangChain prebuilt agent helpers are **not** used for this graph — the tool-calling loop is hand-rolled as raw `StateGraph` nodes (still using `langchain-openai`'s `ChatOpenAI` as the model client). This is required anyway to get mid-loop `interrupt()` points and per-tool-call custom stream events.

## Components

```
POC/
├── agent/
│   ├── aegra.json                       # + "ops_agent": "./src/agent/ops/ops_graph.py:graph"
│   └── src/agent/ops/
│       ├── __init__.py
│       ├── state.py                     # OpsState: messages (add_messages)
│       ├── store.py                     # mock fleet: load/read/mutate services.json, in-memory
│       ├── data/services.json           # ~5 mock services: status, replicas, version, error_rate
│       ├── tools.py                     # think, get_service_status, get_metrics, search_logs,
│       │                                #   list_incidents, restart_service, scale_service,
│       │                                #   rollback_deploy — risky ones just compute the intended
│       │                                #   change; store.py applies it only after approval
│       ├── prompts.py                   # OPS_PROMPT: persona, "always think before acting", grounding
│       └── ops_graph.py                 # StateGraph: agent ⇄ tools, hand-rolled tool loop + interrupt()
├── web/src/
│   ├── App.tsx                          # thin shell: nav + routes (react-router-dom)
│   ├── pages/
│   │   ├── AdInsightPage.tsx            # today's App.tsx content, moved as-is
│   │   └── OpsDeskPage.tsx              # new: useStream(assistantId: "ops_agent") + layout
│   ├── components/
│   │   ├── ThreadSidebar.tsx            # parameterized (assistantId/storageKey) for reuse
│   │   ├── ops/
│   │   │   ├── OpsTranscript.tsx        # chat log: human turns, thinking asides, tool cards,
│   │   │   │                            #   HITL cards, branch switcher
│   │   │   ├── HitlCard.tsx             # approve/deny UI for stream.interrupt
│   │   │   ├── OpsBoard.tsx             # live service grid, driven by "board" custom events
│   │   │   └── SkillBadge.tsx           # tool-name → skill label/color mapping
│   └── lib/
│       └── opsMessages.ts               # derive transcript entries + skill tags from messages/events
└── scripts/smoke_ops.py                 # health check: run reaches interrupt, approve path,
                                          #   deny path, both leave the graph in a completed state
```

## Agent behavior

**Tools:**
- `think(thought: str)` — always available, no side effect beyond being recorded; exists purely so reasoning streams as a distinct, visible tool call rather than being buried in message text.
- Safe (no approval): `get_service_status(service)`, `get_metrics(service, window)`, `search_logs(service, query)`, `list_incidents()`.
- Risky (approval required): `restart_service(service)`, `scale_service(service, replicas)`, `rollback_deploy(service, version)`.

**Graph:** `START → agent`, conditional edge on `agent`'s last message: has `tool_calls` → `tools`, else → `END`. `tools → agent` closes the loop.

- `agent` node: `model.bind_tools([...]).ainvoke(state["messages"])`. System prompt (`OPS_PROMPT`) instructs: use `think` to narrate briefly before other tool calls, ground every claim in tool results, never fabricate fleet state, ask for nothing outside the approval flow (no free-text clarifying questions in v1).
- `tools` node: iterates `tool_calls` **sequentially** (not LangGraph's parallel `ToolNode`):
  1. `think` calls → append a trivial ack `ToolMessage` (e.g. `"noted"`); no store interaction.
  2. safe calls → execute against `store.py`, append `ToolMessage` with JSON result.
  3. risky calls → `interrupt({action, service, args, preview})` first. Preview is a short before/after description (e.g. `replicas: 3 → 5`). On resume:
     - `{"decision": "approve"}` → apply the mutation via `store.py`, append a `ToolMessage` describing what changed.
     - `{"decision": "deny", "reason"?: str}` → append a `ToolMessage` recording the denial (and reason, if given); no mutation.
  4. After each tool call (of any kind), emit a custom event `{"type": "board", "services": store.snapshot()}` so the UI board always reflects server truth.

This relies on the standard LangGraph dynamic-interrupt replay behavior: everything before an `interrupt()` in a node must be safe to re-run on resume. All safe/read tools are idempotent mock reads, so this holds; risky mutations only ever run once, strictly after their `interrupt()` returns an approval.

## UI / UX

**Layout:** thread sidebar (left, reused `ThreadSidebar`) · chat transcript (center) · Ops Board (right, live fleet grid). Composer at the bottom of the transcript column.

**Transcript entries, in order:**
- Human turns as plain bubbles.
- `think` tool calls rendered as italic, low-emphasis asides ("thinking out loud"), streamed live as their args stream in.
- Other tool calls rendered as cards, revealed **one at a time** as each tool call appears in the stream (never batched per agent turn) — same principle as the Ad Insight page's timeline. Each card carries a `SkillBadge` derived from tool name: Diagnostics (read tools), Scaling (`scale_service`), Recovery (`restart_service`, `rollback_deploy`).
- HITL moments render as a distinct `HitlCard`: action, service, preview diff, Approve/Deny buttons. Resolving it collapses it into a small audit chip ("✓ approved" / "✗ denied") that stays in the transcript as a permanent record. Approve/Deny call `stream.submit(undefined, { command: { resume: { decision } } })`.
- Final assistant answer renders as normal streamed text, same as today's report streaming.

**Ops Board:** a small grid of service cards (name, status dot, replicas, version, error rate), replaced wholesale on each `board` custom event — no client-side derivation of fleet state, so it can't drift from what the agent actually did.

**Skill badge (live):** in addition to per-card badges, a single pill near the composer shows the assistant's current mode, updating as tool calls land — e.g. `DIAGNOSTICS`, `SCALING`, `RECOVERY`.

**Time-travel:** hovering any past human message reveals an edit affordance. Editing and resubmitting forks the thread via `useStream`'s branch API (`history`, `branch`, `setBranch`, `getMessagesMetadata`) — no custom checkpoint plumbing needed, this is what the hook already provides. Any message with sibling branches shows a `‹ 1/2 ›` switcher.

**Visual language:** reuses the existing console/dossier design system (Space Grotesk + JetBrains Mono, existing color tokens) rather than introducing a new palette — skill badges reuse `--color-scout`/`--color-writer`/`--color-analyst` under new semantic labels rather than adding new CSS tokens.

## Error handling

- Same fail-fast env var checks as the existing agent on startup.
- Denied actions are a normal `ToolMessage`, not an error — the model must acknowledge and move on.
- Malformed/failed resume shows an inline retry affordance on the `HitlCard` rather than crashing the stream.
- Existing patterns carried over: `onError` banner, `stop()` button, thread reattach-on-reload via `sessionStorage`.

## Testing / verification

- `scripts/smoke_ops.py`: creates a run against `ops_agent` that triggers a risky tool call, asserts the run reports an interrupt, resumes once with approve (asserts fleet state changed) and — in a second thread — once with deny (asserts fleet state unchanged and the run still completes).
- Manual check via `npm run dev`: thinking asides stream live, tool cards appear one-by-one, HITL card blocks until resolved, Ops Board updates on approval, skill badge changes across a diagnostics→scaling turn, edit-and-resubmit produces a visible branch switcher.

## Out of scope (v1)

- HITL "ask a clarifying question" variant (agent-initiated, non-approval interrupt).
- `delete_resource` / any destructive-beyond-recovery tool.
- Auth, multi-user, real infra integration, deployment.
- Ad Insight page changes beyond parameterizing `ThreadSidebar` for reuse.
