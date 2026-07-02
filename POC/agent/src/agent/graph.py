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

from agent.prompts import SYSTEM_PROMPT
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

graph = create_react_agent(model, tools=[search_ads, compare_products], prompt=SYSTEM_PROMPT)
