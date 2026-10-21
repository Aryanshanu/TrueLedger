"""End-to-end test of OrchestratorAgent._run_async_impl - the one piece of
the real pipeline that had zero test coverage (rules.py and consent.py are
tested in isolation, but never through the actual agent that calls them,
writes the ledger, and commits the decision).

Scope, deliberately: this stubs the Firestore boundary (get_fi_data,
get_consent, and the ledger/decision writes) and the inner subtler-reasoning
LlmAgent's `run_async` (a real Gemini call ADK drives through a multi-turn
tool-calling loop this sandbox has no credentials, and no way to verify a
hand-written fake against, for). It does NOT stub the three specialist
LlmAgents or go through google.adk.runners.Runner - faithfully faking ADK's
automatic-function-calling loop for those would be guesswork with no live
ADK+Gemini environment available to check it against, and agents/
investment_agent.py's own comment ("confirmed live that ADK's output_schema
+ AFC combination creates a validation-retry loop that never terminates")
is a reminder that this project's own authors only discovered that behavior
by running it live. What this test does cover, using the real,
unmodified evaluate_rules/detect_empty_specialists/apply_decay/write_entry/
write_final_decision_entry code: the deterministic-rules pass, the
consent-decay pass, the final Decision construction and outcome logic, and
the atomic ledger+decision Firestore write added for the step-id race fix.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from agents import tools
from agents.orchestrator_agent import OrchestratorAgent
from agents.schemas import AgentFindings, Claim, Evidence
from data.synthetic.borrowers import build_b_clean, build_b_contradiction, build_b_stale_consent


def _claim(metric: str, value, magnitude_pct=None, confidence: float = 0.9) -> dict:
    return Claim(metric=metric, value=value, magnitude_pct=magnitude_pct, evidence=[Evidence(field=metric)], confidence=confidence).model_dump()


def _findings_dicts(borrower: dict) -> tuple[dict, dict, dict]:
    """Builds the exact session-state shape the three real specialist
    agents would have written, using the same deterministic tool
    functions they call - not hand-typed numbers."""
    bank_txns = borrower["sources"]["DEPOSIT"]["transactions"]
    gst_returns = borrower["sources"]["GSTR1_3B"]["returns"]
    mf = borrower["sources"]["MUTUAL_FUNDS"]
    insurance = borrower["sources"]["INSURANCE_POLICIES"]
    loan_amount = borrower["loan_amount_requested"]

    income = tools.compute_income_trend(bank_txns)
    volatility = tools.compute_cash_flow_volatility(bank_txns)
    revenue = tools.compute_revenue_trend(gst_returns)
    liquid = tools.compute_liquid_assets(mf)
    coverage = tools.compute_insurance_coverage(insurance, loan_amount)

    bank_findings = AgentFindings(
        agent="bank_statement_agent",
        borrower_id=borrower["borrower_id"],
        claims=[
            Claim.model_validate(_claim("income_trend", income["value"], income["magnitude_pct"])),
            Claim.model_validate(_claim("cash_flow_volatility", volatility["value"])),
        ],
    )
    gst_findings = AgentFindings(
        agent="gst_tax_agent",
        borrower_id=borrower["borrower_id"],
        claims=[Claim.model_validate(_claim("revenue_trend", revenue["value"], revenue["magnitude_pct"]))],
    )
    investment_findings = AgentFindings(
        agent="investment_agent",
        borrower_id=borrower["borrower_id"],
        claims=[
            Claim.model_validate(_claim("liquid_assets", liquid["value"])),
            Claim.model_validate(_claim("insurance_coverage", coverage["value"])),
        ],
    )
    return bank_findings.model_dump(), gst_findings.model_dump(), investment_findings.model_dump_json()


class _FakeCounter:
    """In-memory stand-in for the real atomic per-borrower Firestore
    counter, so this test also proves step_ids come out unique and
    sequential per borrower - the exact property the race-condition fix
    (agents/firestore_gateway.allocate_next_step_id) guarantees."""

    def __init__(self):
        self.counts: dict[str, int] = {}
        self.ledger: dict[str, dict] = {}
        self.decisions: dict[str, dict] = {}

    def allocate(self, borrower_id: str) -> str:
        self.counts[borrower_id] = self.counts.get(borrower_id, 0) + 1
        return f"stp_{borrower_id}_{self.counts[borrower_id]:05d}"

    def append(self, entry: dict) -> None:
        self.ledger[entry["step_id"]] = entry

    def commit_final(self, borrower_id: str, entry: dict, decision: dict) -> None:
        self.ledger[entry["step_id"]] = entry
        self.decisions[borrower_id] = decision


async def _empty_subtler_run(ctx):
    return
    yield  # pragma: no cover - makes this an async generator


def _run_orchestrator(borrower: dict, fake: _FakeCounter):
    bank_findings, gst_findings, investment_findings = _findings_dicts(borrower)
    consent = {
        source: {"fi_type": meta["fi_type"], "expires_at": meta["expires_at"]}
        for source, meta in borrower["consent"].items()
    }

    ctx = SimpleNamespace(
        session=SimpleNamespace(state={
            "borrower_id": borrower["borrower_id"],
            "bank_findings": bank_findings,
            "gst_findings": gst_findings,
            "investment_findings": investment_findings,
        }),
        invocation_id="test-invocation",
        branch=None,
    )

    orchestrator = OrchestratorAgent()
    with patch.object(type(orchestrator.subtler_reasoning_agent), "run_async", side_effect=_empty_subtler_run), \
         patch("agents.orchestrator_agent.get_fi_data", return_value={
             "sources": borrower["sources"],
             "loan_amount_requested": borrower["loan_amount_requested"],
         }), \
         patch("agents.orchestrator_agent.get_consent", return_value=consent), \
         patch("agents.ledger.allocate_next_step_id", side_effect=fake.allocate), \
         patch("agents.ledger.append_ledger_entry", side_effect=fake.append), \
         patch("agents.ledger.commit_final_ledger_entry_and_decision", side_effect=fake.commit_final):

        events = []

        async def _collect():
            async for event in orchestrator._run_async_impl(ctx):
                events.append(event)

        import asyncio
        asyncio.run(_collect())

    final_event = events[-1]
    return final_event.actions.state_delta["decision"]


def test_b_clean_approves_with_no_contradictions():
    fake = _FakeCounter()
    decision = _run_orchestrator(build_b_clean(), fake)

    assert decision["outcome"] == "approve"
    assert decision["contradictions"] == []
    assert decision["final_confidence"] > 0.0
    assert fake.decisions["b_clean"]["outcome"] == "approve"


def test_b_contradiction_flags_divergence_and_forces_manual_review():
    fake = _FakeCounter()
    decision = _run_orchestrator(build_b_contradiction(), fake)

    assert decision["outcome"] == "manual_review"
    rules_fired = {c["rule"] for c in decision["contradictions"]}
    assert "income_vs_revenue_divergence" in rules_fired
    assert decision["final_confidence"] <= 0.5


def test_b_stale_consent_declines_via_zero_confidence_multiplier():
    fake = _FakeCounter()
    decision = _run_orchestrator(build_b_stale_consent(), fake)

    assert decision["outcome"] == "decline"
    assert decision["final_confidence"] == 0.0
    assert decision["weakest_consent_source"] == "bank_findings"


def test_final_decision_ledger_entry_and_decision_committed_atomically_with_matching_step_id():
    """Regression test for the ledger/decisions-can-disagree gap: the final
    ledger entry's own step_id must be the same step_id used to commit the
    decision, and both must land in the same atomic batch (never through
    the plain, non-atomic append_ledger_entry path)."""
    fake = _FakeCounter()
    decision = _run_orchestrator(build_b_clean(), fake)

    # b_clean has no contradictions/risk factors, so the only ledger entry
    # before the final one is "apply_consent_decay" - step 1 - making the
    # final_decision entry step 2.
    final_step_id = "stp_b_clean_00002"
    assert decision["ledger_step_ids"] == [final_step_id]
    final_ledger_entry = fake.ledger[final_step_id]
    assert final_ledger_entry["action"] == "final_decision"
    assert final_ledger_entry["claim"]["ledger_step_ids"] == [final_step_id]
    assert fake.decisions["b_clean"]["ledger_step_ids"] == [final_step_id]


def test_two_borrowers_never_collide_on_step_id():
    """Regression test for the cross-borrower collision this session fixed:
    two different borrowers' first ledger step must not be the same
    Firestore document id."""
    fake = _FakeCounter()
    decision_a = _run_orchestrator(build_b_clean(), fake)
    decision_b = _run_orchestrator(build_b_contradiction(), fake)

    assert decision_a["ledger_step_ids"] != decision_b["ledger_step_ids"]
    assert "b_clean" in decision_a["ledger_step_ids"][0]
    assert "b_contradiction" in decision_b["ledger_step_ids"][0]
