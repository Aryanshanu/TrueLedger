"""Wires the full underwriting pipeline.

    ParallelAgent(bank_statement_agent, gst_tax_agent, investment_agent)
      -> OrchestratorAgent (deterministic rules + subtler LLM pass + decay)

This follows ADK's documented `[Parallel Workers] -> [Synthesizer Agent]`
pattern (see docs/ARCHITECTURE.md), where each parallel sub-agent writes to
its own session-state key (output_key) and a downstream agent consolidates
them.

FLAGGED, NOT SILENTLY ASSUMED: `SequentialAgent` is deprecated in ADK 2.10.0
in favor of a newer `Workflow` graph API (`google.adk.workflow`), which was
not yet documented/stable enough to commit to sight-unseen for a hackathon
timeline. `SequentialAgent` still works in 2.10.0 (deprecated, not removed)
and is what the brief's referenced architecture pattern uses, so this
scaffold uses it deliberately rather than the newer API - revisit if a
future `google-adk` upgrade removes it.
"""

from __future__ import annotations

import warnings

from google.adk.agents import ParallelAgent, SequentialAgent

from agents.bank_agent import build_bank_statement_agent
from agents.gst_agent import build_gst_tax_agent
from agents.investment_agent import build_investment_agent
from agents.orchestrator_agent import OrchestratorAgent


def build_pipeline() -> SequentialAgent:
    specialists = ParallelAgent(
        name="specialist_sub_agents",
        description="Runs the bank, GST/tax, and investment specialist agents concurrently.",
        sub_agents=[
            build_bank_statement_agent(),
            build_gst_tax_agent(),
            build_investment_agent(),
        ],
    )
    orchestrator = OrchestratorAgent()

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=r".*SequentialAgent is deprecated.*", category=DeprecationWarning)
        return SequentialAgent(
            name="underwriting_pipeline",
            description="Full underwriting pipeline: parallel specialists then the orchestrator.",
            sub_agents=[specialists, orchestrator],
        )
