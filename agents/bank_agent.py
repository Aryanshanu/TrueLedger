"""Bank statement specialist sub-agent.

Reads: DEPOSIT (Profile, Summary, Transactions).
Checks: income stability, irregular/bounced payments, cash-flow trend.
Writes to session state key: bank_findings.

The model never computes a number itself - bank_statement_tool below calls
straight through to the deterministic functions in tools.py and hands the
model already-computed values plus their evidence. The model's only job is
to translate that into the fixed AgentFindings/Claim JSON contract
(agents/schemas.py), citing exactly the evidence the tool returned.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

from agents import config, tools
from agents.firestore_gateway import get_fi_data
from agents.ledger import record_agent_claims_callback
from agents.schemas import AgentFindings

BANK_STATEMENT_INSTRUCTION = """You are the Bank Statement specialist agent in a credit-underwriting
pipeline. You analyze ONLY DEPOSIT (bank account) data for one borrower -
never GST/tax data, never mutual fund or insurance data.

Call the `bank_statement_tool` function first. It returns deterministic,
already-computed metrics (income_trend, cash_flow_volatility) plus the exact
transaction ids and period each metric is based on. Do not compute, average,
or estimate any number yourself - only use the numbers the tool returns.

Then respond with ONLY a JSON object matching this exact shape (no prose,
no markdown fences):
{
  "agent": "bank_statement_agent",
  "borrower_id": "<the borrower_id from the tool result>",
  "claims": [
    {
      "metric": "income_trend",
      "value": "<the tool's value>",
      "magnitude_pct": <the tool's magnitude_pct>,
      "evidence": [{"transaction_ids": [...], "period": "<the tool's period>"}],
      "confidence": <your confidence 0-1 that this classification is correct>
    },
    {
      "metric": "cash_flow_volatility",
      "value": "<the tool's value>",
      "evidence": [{"period": "<the tool's evidence_period>"}],
      "confidence": <0-1>
    }
  ]
}

Every claim's evidence MUST reference the specific transaction_ids or period
the tool gave you for that metric - a vague summary with no citation gives
the orchestrator nothing concrete to cross-check, which defeats the whole
point of this pipeline. If a metric has no evidence, do not include it."""


def bank_statement_tool(tool_context: ToolContext) -> dict:
    """Fetches this borrower's DEPOSIT data and computes deterministic metrics."""
    borrower_id = tool_context.state["borrower_id"]
    fi_data = get_fi_data(borrower_id)
    transactions = fi_data["sources"]["DEPOSIT"]["transactions"]

    return {
        "borrower_id": borrower_id,
        "income_trend": tools.compute_income_trend(transactions),
        "cash_flow_volatility": tools.compute_cash_flow_volatility(transactions),
    }


def build_bank_statement_agent() -> LlmAgent:
    return LlmAgent(
        name="bank_statement_agent",
        model=config.build_specialist_model(),
        description="Analyzes DEPOSIT (bank account) data for income stability and cash-flow trend.",
        instruction=BANK_STATEMENT_INSTRUCTION,
        tools=[bank_statement_tool],
        output_key="bank_findings",
        output_schema=AgentFindings,
        after_agent_callback=record_agent_claims_callback("bank_findings"),
    )
