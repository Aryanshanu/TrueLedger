"""The explainability ledger: an append-only trail of every pipeline step.

"This is the audit trail QED's warning is actually about: not a score, a
trace." Every entry is written once and never edited - the replay UI reads
this collection start-to-finish to reconstruct exactly which data point
drove which part of the decision.

Steps 1-3 (the specialist sub-agents) each get one ledger entry per claim,
written automatically via `record_agent_claims_callback` as an
`after_agent_callback`. Step 4 (the orchestrator) writes one entry per
contradiction/risk factor it flags, plus one for its consent-decay
application. Step 5 is the final decision entry.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from agents.firestore_gateway import append_ledger_entry, get_ledger
from agents.schemas import AgentFindings, LedgerEntry


def _next_step_id(borrower_id: str) -> str:
    # Demo-scale sequencing: fine for a hackathon's single-pipeline-run-at-a-
    # time load. A production system would use a Firestore transaction or a
    # dedicated counter document instead of counting the whole collection.
    existing = get_ledger(borrower_id)
    return f"stp_{len(existing) + 1:05d}"


def write_entry(
    *,
    borrower_id: str,
    agent: str,
    action: str,
    input_refs: list[str],
    claim: dict,
    confidence: float,
    notes: str = "",
) -> LedgerEntry:
    entry = LedgerEntry(
        step_id=_next_step_id(borrower_id),
        borrower_id=borrower_id,
        agent=agent,
        timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        action=action,
        input_refs=input_refs,
        claim=claim,
        confidence=confidence,
        notes=notes,
    )
    append_ledger_entry(entry.model_dump())
    return entry


def parse_findings_payload(raw: dict | str) -> dict:
    """Normalizes a sub-agent's output_key state value into a dict.

    ADK writes a validated dict when the agent has `output_schema` set
    (bank/gst agents). It writes the model's raw text instead when
    `output_schema` is omitted (investment_agent.py - see its build
    function for why that's sometimes necessary), so this also handles a
    JSON string, including one the model wrapped in markdown fences despite
    being told not to.
    """
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-z]*\n?", "", text).rstrip("`").strip()
        return json.loads(text)
    return raw


def record_findings(findings: AgentFindings) -> list[LedgerEntry]:
    """One ledger entry per claim a specialist sub-agent produced."""
    entries = []
    for claim in findings.claims:
        entries.append(
            write_entry(
                borrower_id=findings.borrower_id,
                agent=findings.agent,
                action="record_claim",
                input_refs=[f"fi_data/{findings.borrower_id}"],
                claim=claim.model_dump(),
                confidence=claim.confidence,
                notes=f"{findings.agent} claim: {claim.metric}",
            )
        )
    return entries


def record_agent_claims_callback(output_key: str):
    """Factory for an ADK `after_agent_callback` that ledgers a sub-agent's
    findings the moment it finishes, so replay steps 1-3 have entries to
    click through even before the orchestrator runs."""

    async def _callback(ctx):
        raw = ctx.state.get(output_key)
        if not raw:
            return None
        try:
            payload = parse_findings_payload(raw)
        except (json.JSONDecodeError, ValueError):
            return None
        findings = AgentFindings.model_validate(payload)
        record_findings(findings)
        return None

    return _callback
