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
    ai_text_by_id: dict[str, str] = {}
    phase_events: list[dict] = []

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
            # NOTE: deviation from brief — live server streams AIMessageChunk (never
            # bare "ai") with content split token-by-token, keyed by a stable "id".
            # Chunks must be accumulated by id to recover full message text.
            if msg.get("type") in ("ai", "AIMessageChunk") and isinstance(msg.get("content"), str) and msg["content"]:
                msg_id = msg.get("id")
                if not msg_id:
                    # No stable id to group chunks by: don't fall back to keying by
                    # content, which would silently inflate ok_mid_run by counting
                    # every distinct token chunk as its own "message". Skip instead,
                    # and warn loudly since this is a fail-fast diagnostic script.
                    print(f"WARNING: AI message chunk missing id, skipping: {msg['content']!r}",
                          file=sys.stderr)
                    continue
                ai_text_by_id[msg_id] = ai_text_by_id.get(msg_id, "") + msg["content"]

    ai_message_texts = list(ai_text_by_id.values())
    final_text = next((t for t in ai_message_texts if "## Verdict" in t), "")

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
