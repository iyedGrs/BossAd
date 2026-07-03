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
# The mock fleet store is a single process-wide singleton (by design, see
# agent.ops.store), so the approve and deny paths below must target
# different services within one script run — otherwise the approve path's
# mutation heals the service and the deny path's model has nothing left to
# restart, so it never interrupts and the resume call fails.
ASK_APPROVE = ("search-index is down — investigate and restart it if "
               "that's warranted.")
ASK_DENY = ("checkout-service is showing a high error rate — investigate "
            "and restart it if that's warranted.")


async def _run_until_interrupt(client, thread_id: str, ask: str) -> dict | None:
    interrupt_value = None
    async for chunk in client.runs.stream(
        thread_id=thread_id,
        assistant_id=ASSISTANT_ID,
        input={"messages": [{"type": "human", "content": ask}]},
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
    approve_interrupt = await _run_until_interrupt(client, approve_thread["thread_id"], ASK_APPROVE)
    ok_interrupt = bool(approve_interrupt) and approve_interrupt.get("action") == "restart_service"
    await _resume(client, approve_thread["thread_id"], {"decision": "approve"})
    approve_result = await _last_tool_result(client, approve_thread["thread_id"], "restart_service")
    ok_approved = bool(approve_result) and approve_result.get("status") == "healthy"

    print(f"interrupted with action restart_service: {ok_interrupt}")
    print(f"approve path: action actually ran (status=healthy): {ok_approved}")

    # --- deny path ---
    deny_thread = await client.threads.create()
    deny_interrupt = await _run_until_interrupt(client, deny_thread["thread_id"], ASK_DENY)
    ok_interrupt_2 = bool(deny_interrupt)
    await _resume(client, deny_thread["thread_id"], {"decision": "deny", "reason": "smoke test denial"})
    deny_result = await _last_tool_result(client, deny_thread["thread_id"], "restart_service")
    ok_denied = bool(deny_result) and deny_result.get("denied") is True

    print(f"second run also interrupted: {ok_interrupt_2}")
    print(f"deny path: action recorded as denied, not run: {ok_denied}")

    return 0 if (ok_interrupt and ok_approved and ok_interrupt_2 and ok_denied) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
