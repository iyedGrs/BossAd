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

from langchain_openai import AzureChatOpenAI
from langgraph.prebuilt import create_react_agent

from agent.prompts import SYSTEM_PROMPT
from agent.tools import compare_products, search_ads

model = AzureChatOpenAI(
    azure_deployment=os.environ["AZURE_OPENAI_DEPLOYMENT"],
    api_version=os.environ.get("OPENAI_API_VERSION", "2024-10-21"),
    temperature=0.3,
    streaming=True,
)

graph = create_react_agent(model, tools=[search_ads, compare_products], prompt=SYSTEM_PROMPT)
