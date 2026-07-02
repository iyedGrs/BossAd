# POC v2 — Multi-Agent Streaming + Redesign (Design Spec)

**Date:** 2026-07-02 · **Status:** Approved by user
**Builds on:** `2026-07-02-poc-aegra-usestream-design.md` (the working single-agent POC)

## Goal

Evolve the working POC from a single `create_react_agent` into a small multi-agent
LangGraph graph, stream its step-by-step state to the frontend as it runs (not just
final tokens), prove that messages streamed *mid-run* (before the run completes)
render live in the UI, and give the app a distinctive light/dark visual redesign.

## What's changing and why

The current POC (`POC/agent/src/agent/graph.py`) is one `create_react_agent` node
with two tools. The frontend infers "steps" by parsing tool-call messages after the
fact (`POC/web/src/lib/messages.ts`). This works but gives no real intermediate
state to show, and there's only one place work happens — nothing to prove
mid-run streaming actually works end-to-end. This round adds real structure to
stream from, and a UI to show it.

## 1. Agent graph — supervisor + 3 subagents

Replace the single node with a `StateGraph`:

```
supervisor (deterministic router, no LLM call)
  ├─ market_scout    — create_react_agent bound only to search_ads      ("research" skill)
  ├─ scoring_analyst — create_react_agent bound only to compare_products ("scoring" skill)
  └─ report_writer   — plain LLM call, no tools — synthesizes the final Verdict markdown
```

**State** (`TypedDict`, extends the existing `messages` reducer):
- `messages: Annotated[list, add_messages]` (unchanged)
- `search_results: list[dict] | None` — accumulated `search_ads` output
- `scores: list[dict] | None` — accumulated `compare_products` output
- `phase: str` — current subagent name, for custom-event dispatch

**Routing** — a single conditional-edge function reads state, no LLM call:
- no `search_results` yet → `market_scout`
- `search_results` present, no `scores` → `scoring_analyst`
- `scores` present → `report_writer` → `END`

This is deterministic and cheap to test. Each subagent still does its own
LLM+tool reasoning loop — that's where "skills" live (one tool bundle per
subagent). Each subagent's system prompt is scoped to its one job (existing
`SYSTEM_PROMPT` in `prompts.py` is split into `SCOUT_PROMPT`, `ANALYST_PROMPT`,
`WRITER_PROMPT`).

**Handoff narration** — when the supervisor routes from one subagent to the
next, it appends a short AI message to state before invoking the next subagent
(e.g. "Handing off to Scoring Analyst…"). This message streams to the client
*before* the next subagent starts its own LLM call — the concrete proof that
mid-run streaming works, not just final-token streaming.

## 2. Custom event streaming (agent steps/state)

- Each subagent node calls `adispatch_custom_event("phase", {...})` from
  `langchain_core.callbacks.manager` on entry and exit, e.g.:
  `{"phase": "scout", "status": "start", "label": "Scouting ads in Berlin…"}`
  `{"phase": "scout", "status": "done", "label": "Found 6 candidate ads"}`
- Backend graph invocation must run under a stream mode that includes `"custom"`
  in addition to `"messages"` — verify Aegra passes this through (Aegra proxies
  the LangGraph Server streaming API; if `custom` isn't supported end-to-end,
  fall back to encoding phase markers as tagged AI messages and filtering them
  client-side — decide during implementation based on what actually streams).
- Frontend: `useStream` config adds `streamMode: ["messages", "custom"]` and an
  `onCustomEvent` handler that appends events to a new `phases` array in
  component state (separate from `stream.messages`).
- `POC/web/src/lib/messages.ts` gains a `derivePhases`-equivalent merge: phase
  events + tool-call entries are interleaved and grouped per subagent in
  `AgentTimeline`, each subagent given a distinct label/color (Scout / Analyst
  / Writer).

## 3. Visual redesign (light + dark)

Keep the current 3-pane structure (Threads sidebar / Composer+Timeline /
Live report) — this round restyles, it doesn't restructure. Delegated to a
Haiku subagent (via the `frontend-design` skill) to produce:
- A light + dark theme pair as CSS custom properties (`POC/web/src/index.css`
  already uses a `@theme` token block — extend it with a `[data-theme="light"]`
  override set), with a toggle persisted in `localStorage`.
- Refined typography/motion consistent with the existing serif/sans/mono
  pairing already in place.
- Distinct per-subagent visual treatment in `AgentTimeline` (color/icon per
  Scout/Analyst/Writer) so the new step granularity is legible, not just more
  chips of the same kind.
- No layout restructuring, no new pages/routes.

## 4. Testing

- New unit tests (`POC/agent/tests/`) for the router: given a state with no
  `search_results`, route to scout; given `search_results` but no `scores`,
  route to analyst; given `scores`, route to writer — pure function tests, no
  LLM calls, matching the existing test style (6 tests currently pass without
  a running server or real credentials).
- `POC/scripts/smoke.py` extended to assert, against a live run:
  - subagents fire in order (scout → analyst → writer) — inferred from custom
    events or tagged messages, whichever the implementation lands on
  - tool calls present from both `search_ads` and `compare_products`
  - at least 2 distinct AI messages appear **before** the final report message
    (proves mid-run streaming, not just end-of-run)
  - final message still contains `## Verdict` (existing assertion, unchanged)

## Out of scope for this round

- No LLM-driven supervisor (deterministic routing only — revisit if the
  deterministic router proves too rigid in practice).
- No new tools/skills beyond the existing two (`search_ads`, `compare_products`)
  — "skills" here means scoping existing tools per subagent, not adding new
  capabilities.
- No auth, no real Meta Ad Library data, no production deploy changes — same
  mock-data POC scope as the original design.
