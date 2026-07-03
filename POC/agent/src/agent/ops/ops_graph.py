"""Ops Desk POC graph — served by Aegra as assistant id `ops_agent`.

Hand-rolled tool-calling loop (no create_react_agent) so we control exactly
when each tool call streams and where the human-approval interrupt lands."""
import json

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from agent.model import model
from agent.ops import store
from agent.ops.prompts import OPS_PROMPT
from agent.ops.state import OpsState
from agent.ops.tools import RISKY_TOOL_NAMES, TOOLS, TOOLS_BY_NAME

_model_with_tools = model.bind_tools(TOOLS)


def preview_for(name: str, args: dict) -> str:
    """One-line before/after description shown on the approval card."""
    service = args.get("service", "?")
    current = store.get(service) or {}
    if name == "restart_service":
        return f"{service}: status {current.get('status', '?')} → healthy"
    if name == "scale_service":
        return f"{service}: replicas {current.get('replicas', '?')} → {args.get('replicas', '?')}"
    if name == "rollback_deploy":
        return f"{service}: version {current.get('version', '?')} → {args.get('version', '?')}"
    return f"{service}: {args}"


async def agent_node(state: OpsState) -> dict:
    response = await _model_with_tools.ainvoke(
        [{"role": "system", "content": OPS_PROMPT}, *state["messages"]]
    )
    return {"messages": [response]}


def route_from_agent(state: OpsState) -> str:
    last: AIMessage = state["messages"][-1]
    return "tools" if getattr(last, "tool_calls", None) else END


async def tools_node(state: OpsState) -> dict:
    last: AIMessage = state["messages"][-1]
    writer = get_stream_writer()
    new_messages: list[ToolMessage] = []

    for tc in last.tool_calls:
        name, args, call_id = tc["name"], tc["args"], tc["id"]

        if name in RISKY_TOOL_NAMES:
            decision = interrupt({
                "action": name,
                "service": args.get("service"),
                "args": args,
                "preview": preview_for(name, args),
            })
            if decision.get("decision") == "approve":
                result = TOOLS_BY_NAME[name].invoke(args)
            else:
                result = json.dumps({
                    "denied": True,
                    "reason": decision.get("reason", "no reason given"),
                })
        else:
            result = TOOLS_BY_NAME[name].invoke(args)

        new_messages.append(ToolMessage(content=result, tool_call_id=call_id, name=name))
        writer({"type": "board", "services": store.snapshot()})

    return {"messages": new_messages}


_builder = StateGraph(OpsState)
_builder.add_node("agent", agent_node)
_builder.add_node("tools", tools_node)
_builder.add_edge(START, "agent")
_builder.add_conditional_edges("agent", route_from_agent, {"tools": "tools", END: END})
_builder.add_edge("tools", "agent")

graph = _builder.compile()
