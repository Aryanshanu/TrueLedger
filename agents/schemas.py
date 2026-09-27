"""Shared data contracts.

Every sub-agent, the orchestrator, the ledger writer, and the frontend read
the same shapes defined here. Sub-agents return structured claims, never
prose: numbers are computed by a deterministic tool function first (see
tools.py), so the model can only cite them, not invent them.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Evidence(BaseModel):
    """A pointer back to the exact raw record a claim is based on."""

    transaction_ids: Optional[list[str]] = None
    period: Optional[str] = None
    field: Optional[str] = None
    source: Optional[str] = None


class Claim(BaseModel):
    metric: str
    value: str
    magnitude_pct: Optional[float] = None
    evidence: list[Evidence]
    confidence: float = Field(ge=0, le=1)


class AgentFindings(BaseModel):
    """The fixed output contract every specialist sub-agent must produce."""

    agent: Literal["bank_statement_agent", "gst_tax_agent", "investment_agent"]
    borrower_id: str
    claims: list[Claim]


class LedgerEntry(BaseModel):
    """One immutable, append-only step in the explainability ledger."""

    step_id: str
    borrower_id: str
    agent: str
    timestamp: str
    action: str
    input_refs: list[str]
    claim: dict
    confidence: float
    notes: str = ""


class ConsentSourceStatus(BaseModel):
    source: str  # bank_findings | gst_findings | investment_findings
    fi_type: str
    expires_at: str
    days_remaining: int
    confidence_multiplier: float


class Contradiction(BaseModel):
    rule: str
    metric: str
    finding: str
    evidence: list[Evidence]
    action: str


class RiskFactor(BaseModel):
    rule: str
    metric: str
    finding: str
    evidence: list[Evidence]


class Decision(BaseModel):
    borrower_id: str
    outcome: Literal["approve", "manual_review", "decline"]
    final_confidence: float
    model_confidence: float
    weakest_consent_source: Optional[str] = None
    contradictions: list[Contradiction] = []
    risk_factors: list[RiskFactor] = []
    ledger_step_ids: list[str] = []
    generated_at: str
