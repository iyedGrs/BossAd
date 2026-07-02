"""Pure decision function for the supervisor node — no LLM call, no I/O."""
from typing import Literal

from agent.state import AgentState

Phase = Literal["market_scout", "scoring_analyst", "report_writer", "end"]


def decide_next(state: AgentState) -> Phase:
    if state.get("report_done"):
        return "end"
    if state.get("search_results") is None:
        return "market_scout"
    if state.get("scores") is None:
        return "scoring_analyst"
    return "report_writer"
