"""Pulls structured tool output back out of a subagent's message trail."""
import json


def extract_tool_json(messages: list, tool_name: str) -> list[dict] | None:
    for msg in reversed(messages):
        if getattr(msg, "name", None) == tool_name and getattr(msg, "content", None) is not None:
            return json.loads(msg.content)
    return None
