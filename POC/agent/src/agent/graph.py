"""BossAd POC graph — served by Aegra as assistant id `agent`."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[2] / ".env")

_REQUIRED = ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]
_missing = [k for k in _REQUIRED if not os.environ.get(k)]
if _missing:
    raise RuntimeError(
        f"Missing env vars: {', '.join(_missing)}. "
        "Copy POC/agent/.env.example to POC/agent/.env and fill them in."
    )

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from agent.tools import compare_products, search_ads

# Azure AI Foundry resources expose the OpenAI-compatible *v1* surface
# (<endpoint>/openai/v1/) instead of the legacy ?api-version= deployments
# route, so we use ChatOpenAI with a base_url; `model` is the deployment name.
_V1_BASE_URL = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/") + "/openai/v1/"

model = ChatOpenAI(
    base_url=_V1_BASE_URL,
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
    streaming=True,
)

import json

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from agent.extract import extract_tool_json
from agent.prompts import ANALYST_PROMPT, SCOUT_PROMPT, WRITER_PROMPT
from agent.router import decide_next
from agent.state import AgentState

_scout_agent = create_react_agent(model, tools=[search_ads], prompt=SCOUT_PROMPT)
_analyst_agent = create_react_agent(model, tools=[compare_products], prompt=ANALYST_PROMPT)

_PHASE_LABELS = {
    "market_scout": "Handing off to Market Scout…",
    "scoring_analyst": "Handing off to Scoring Analyst…",
    "report_writer": "Handing off to Report Writer…",
}


async def supervisor_node(state: AgentState) -> dict:
    next_phase = decide_next(state)
    if next_phase == "end":
        return {}
    writer = get_stream_writer()
    writer({"phase": next_phase, "status": "start", "label": _PHASE_LABELS[next_phase]})
    return {"messages": [AIMessage(content=_PHASE_LABELS[next_phase])]}


def route_from_supervisor(state: AgentState) -> str:
    return decide_next(state) if decide_next(state) != "end" else END


async def market_scout_node(state: AgentState) -> dict:
    result = await _scout_agent.ainvoke({"messages": state["messages"]})
    new_messages = result["messages"][len(state["messages"]):]
    search_results = extract_tool_json(new_messages, "search_ads") or []
    writer = get_stream_writer()
    writer({"phase": "market_scout", "status": "done",
             "label": f"Found {len(search_results)} candidate ads"})
    return {"messages": new_messages, "search_results": search_results}


async def scoring_analyst_node(state: AgentState) -> dict:
    result = await _analyst_agent.ainvoke({"messages": state["messages"]})
    new_messages = result["messages"][len(state["messages"]):]
    scores = extract_tool_json(new_messages, "compare_products") or []
    writer = get_stream_writer()
    writer({"phase": "scoring_analyst", "status": "done",
             "label": f"Scored {len(scores)} products"})
    return {"messages": new_messages, "scores": scores}


async def report_writer_node(state: AgentState) -> dict:
    response = await model.ainvoke(
        [{"role": "system", "content": WRITER_PROMPT}, *state["messages"]]
    )
    writer = get_stream_writer()
    writer({"phase": "report_writer", "status": "done", "label": "Report complete"})
    return {"messages": [response], "report_done": True}


_builder = StateGraph(AgentState)
_builder.add_node("supervisor", supervisor_node)
_builder.add_node("market_scout", market_scout_node)
_builder.add_node("scoring_analyst", scoring_analyst_node)
_builder.add_node("report_writer", report_writer_node)
_builder.add_edge(START, "supervisor")
_builder.add_conditional_edges("supervisor", route_from_supervisor, {
    "market_scout": "market_scout",
    "scoring_analyst": "scoring_analyst",
    "report_writer": "report_writer",
    END: END,
})
_builder.add_edge("market_scout", "supervisor")
_builder.add_edge("scoring_analyst", "supervisor")
_builder.add_edge("report_writer", "supervisor")

graph = _builder.compile()
