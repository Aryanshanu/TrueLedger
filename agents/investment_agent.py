"""Mutual fund and insurance specialist sub-agent.

Reads: MUTUAL_FUNDS, INSURANCE_POLICIES.
Checks: asset cushion (liquid assets), insurance coverage adequacy.
Writes to session state key: investment_findings.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents import config, tools
from agents.firestore_gateway import get_fi_data
from agents.ledger import record_agent_claims_callback
from agents.schemas import AgentFindings

INVESTMENT_INSTRUCTION = """You are the Mutual Fund and Insurance specialist agent in a
credit-underwriting pipeline. You analyze ONLY MUTUAL_FUNDS and
INSURANCE_POLICIES data for one borrower - never bank data, never GST/tax
data.

Call the `investment_tool` function first. It returns deterministic,
already-computed metrics (liquid_assets, insurance_coverage) plus the exact
holdings/policy ids each metric is based on. Do not compute, average, or
estimate any number yourself - only use the numbers the tool returns.

Then respond with ONLY a JSON object matching this exact shape (no prose,
no markdown fences):
{
  "agent": "investment_agent",
  "borrower_id": "<the borrower_id from the tool result>",
  "claims": [
    {
      "metric": "liquid_assets",
      "value": "<the tool's value>",
      "evidence": [{"field": "total_current_value"}],
      "confidence": <your confidence 0-1 that this classification is correct>
    },
    {
      "metric": "insurance_coverage",
      "value": "<the tool's value>",
      "evidence": [{"field": "total_sum_assured"}],
      "confidence": <0-1>
    }
  ]
}

Cite the tool's returned holdings/policy identifiers in evidence where
available. If a metric has no evidence, do not include it."""


def investment_tool(tool_context: ToolContext) -> dict:
    """Fetches this borrower's MF + insurance data and computes deterministic metrics."""
    borrower_id = tool_context.state["borrower_id"]
    fi_data = get_fi_data(borrower_id)
    mf_data = fi_data["sources"]["MUTUAL_FUNDS"]
    insurance_data = fi_data["sources"]["INSURANCE_POLICIES"]
    loan_amount_requested = fi_data["loan_amount_requested"]

    return {
        "borrower_id": borrower_id,
        "liquid_assets": tools.compute_liquid_assets(mf_data),
        "insurance_coverage": tools.compute_insurance_coverage(insurance_data, loan_amount_requested),
    }


def build_investment_agent() -> LlmAgent:
    return LlmAgent(
        name="investment_agent",
        model=config.SPECIALIST_MODEL,
        description="Analyzes MUTUAL_FUNDS and INSURANCE_POLICIES data for asset cushion and coverage adequacy.",
        instruction=INVESTMENT_INSTRUCTION,
        tools=[investment_tool],
        output_key="investment_findings",
        output_schema=AgentFindings,
        after_agent_callback=record_agent_claims_callback("investment_findings"),
    )
