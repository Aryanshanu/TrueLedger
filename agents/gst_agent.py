"""GST/tax specialist sub-agent.

Reads: GSTR1_3B (Profile, Summary, Returns).
Checks: revenue trend, filing consistency, declared-vs-actual gaps.
Writes to session state key: gst_findings.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents import config, tools
from agents.firestore_gateway import get_fi_data
from agents.ledger import record_agent_claims_callback
from agents.schemas import AgentFindings

GST_TAX_INSTRUCTION = """You are the GST/Tax specialist agent in a credit-underwriting pipeline.
You analyze ONLY GSTR1_3B (GST return) data for one borrower - never bank
data, never mutual fund or insurance data.

Call the `gst_tax_tool` function first. It returns deterministic,
already-computed metrics (revenue_trend, filing_consistency) plus the exact
filing periods each metric is based on. Do not compute, average, or estimate
any number yourself - only use the numbers the tool returns.

Then respond with ONLY a JSON object matching this exact shape (no prose,
no markdown fences):
{
  "agent": "gst_tax_agent",
  "borrower_id": "<the borrower_id from the tool result>",
  "claims": [
    {
      "metric": "revenue_trend",
      "value": "<the tool's value>",
      "magnitude_pct": <the tool's magnitude_pct>,
      "evidence": [{"period": "<one of the tool's evidence_periods>"}],
      "confidence": <your confidence 0-1 that this classification is correct>
    },
    {
      "metric": "filing_consistency",
      "value": "<the tool's value>",
      "evidence": [{"period": "<one of the tool's evidence_periods>"}],
      "confidence": <0-1>
    }
  ]
}

Every claim's evidence MUST reference the specific filing period(s) the tool
gave you for that metric - the orchestrator later cross-checks this against
the bank agent's findings for that exact period, so a vague summary with no
citation breaks that check. If a metric has no evidence, do not include it."""


def gst_tax_tool(tool_context: ToolContext) -> dict:
    """Fetches this borrower's GSTR1_3B data and computes deterministic metrics."""
    borrower_id = tool_context.state["borrower_id"]
    fi_data = get_fi_data(borrower_id)
    returns = fi_data["sources"]["GSTR1_3B"]["returns"]

    return {
        "borrower_id": borrower_id,
        "revenue_trend": tools.compute_revenue_trend(returns),
        "filing_consistency": tools.compute_filing_consistency(returns),
    }


def build_gst_tax_agent() -> LlmAgent:
    return LlmAgent(
        name="gst_tax_agent",
        model=config.build_specialist_model(),
        description="Analyzes GSTR1_3B (GST return) data for revenue trend and filing consistency.",
        instruction=GST_TAX_INSTRUCTION,
        tools=[gst_tax_tool],
        output_key="gst_findings",
        output_schema=AgentFindings,
        after_agent_callback=record_agent_claims_callback("gst_findings"),
    )
