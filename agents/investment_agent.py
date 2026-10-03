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

INVESTMENT_INSTRUCTION = """You are the Mutual Fund and Insurance specialist agent in a
credit-underwriting pipeline. You analyze ONLY MUTUAL_FUNDS and
INSURANCE_POLICIES data for one borrower - never bank data, never GST/tax
data.

Call the `investment_tool` function ONCE. It returns deterministic,
already-computed metrics. Do not call the tool a second time.

The tool returns two metrics:
- liquid_assets: has "value", "total_current_value", and "evidence_holdings" (list of scheme names)
- insurance_coverage: has "value", "total_sum_assured", and "evidence_policy_ids" (list of policy IDs)

Respond with ONLY a JSON object (no prose, no markdown fences):
{
  "agent": "investment_agent",
  "borrower_id": "<the borrower_id from the tool result>",
  "claims": [
    {
      "metric": "liquid_assets",
      "value": "<the tool's liquid_assets.value>",
      "evidence": [{"field": "total_current_value", "source": "MUTUAL_FUNDS", "transaction_ids": <the tool's liquid_assets.evidence_holdings list>}],
      "confidence": <0-1>
    },
    {
      "metric": "insurance_coverage",
      "value": "<the tool's insurance_coverage.value>",
      "evidence": [{"field": "total_sum_assured", "source": "INSURANCE_POLICIES", "transaction_ids": <the tool's insurance_coverage.evidence_policy_ids list>}],
      "confidence": <0-1>
    }
  ]
}"""


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
    # output_schema intentionally omitted: confirmed live that ADK's
    # output_schema + AFC (automatic function calling) combination creates a
    # validation-retry loop that never terminates for this agent specifically
    # (bank/gst agents happened to converge; investment never did, hanging
    # indefinitely on b_stale_consent). Without output_schema, ADK writes the
    # model's raw text to output_key instead of a validated dict;
    # record_agent_claims_callback (agents/ledger.py) and the orchestrator's
    # _load_findings both parse that JSON string.
    return LlmAgent(
        name="investment_agent",
        model=config.build_specialist_model(),
        description="Analyzes MUTUAL_FUNDS and INSURANCE_POLICIES data for asset cushion and coverage adequacy.",
        instruction=INVESTMENT_INSTRUCTION,
        tools=[investment_tool],
        output_key="investment_findings",
        after_agent_callback=record_agent_claims_callback("investment_findings"),
    )
