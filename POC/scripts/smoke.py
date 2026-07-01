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
