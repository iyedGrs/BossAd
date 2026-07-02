import json

from langchain_core.messages import AIMessage, ToolMessage

from agent.extract import extract_tool_json


def test_extract_tool_json_finds_last_matching_tool_message():
    messages = [
        AIMessage(content="", tool_calls=[{"name": "search_ads", "args": {}, "id": "call_1"}]),
        ToolMessage(content=json.dumps([{"ad_id": "ad_0001"}]), tool_call_id="call_1", name="search_ads"),
    ]
    result = extract_tool_json(messages, "search_ads")
    assert result == [{"ad_id": "ad_0001"}]


def test_extract_tool_json_returns_none_when_absent():
    assert extract_tool_json([AIMessage(content="hi")], "search_ads") is None


def test_extract_tool_json_picks_last_when_multiple():
    messages = [
        ToolMessage(content=json.dumps([{"ad_id": "ad_0001"}]), tool_call_id="call_1", name="search_ads"),
        ToolMessage(content=json.dumps([{"ad_id": "ad_0002"}]), tool_call_id="call_2", name="search_ads"),
    ]
    result = extract_tool_json(messages, "search_ads")
    assert result == [{"ad_id": "ad_0002"}]
