"""Shared graph state for the supervisor + subagent graph."""
from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    search_results: list[dict] | None
    scores: list[dict] | None
    report_done: bool
