"""Graph state for the Ops Desk agent."""
from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class OpsState(TypedDict):
    messages: Annotated[list, add_messages]
