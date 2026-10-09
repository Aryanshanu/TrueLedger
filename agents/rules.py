"""The orchestrator's deterministic rule table.

"Orchestrator: deterministic rules first, LLM reasoning second." A small
fixed rule table catches the contradictions we already know matter; the
orchestrator's LLM pass (see orchestrator_agent.py) is for the subtler cases
this table misses. Keeping these four rules as plain Python, not model
judgement, is what keeps the highest-stakes checks auditable.

Rule                          Signals compared                                  Condition                                                          Action
----                          -----------------                                 ---------                                                          ------
Specialist produced no claims  bank/gst/investment findings                     a specialist's claims list is empty                                note as risk factor, caller forces manual review (see detect_empty_specialists)
Income vs revenue divergence  bank.income_trend, gst.revenue_trend              bank stable/rising while gst declining                             flag contradiction, cap confidence at 0.5
Declared vs actual mismatch   gst.declared_turnover, bank.total_credits         gap exceeds 15%                                                    flag contradiction, request manual review
Asset cushion vs cash flow    investment.liquid_assets, bank.cash_flow_volatility  high volatility + high liquid assets claimed, no drawdown evidence  flag contradiction
Insurance coverage gap        investment.insurance_coverage, loan amount        coverage well below the requested loan size                        note as risk factor, not a hard contradiction
"""

from __future__ import annotations

from agents.config import DECLARED_VS_ACTUAL_GAP_PCT
from agents.schemas import AgentFindings, Claim, Contradiction, Evidence, RiskFactor


EMPTY_SPECIALIST_RULE = "specialist_produced_no_claims"


def _get_claim(findings: AgentFindings, metric: str) -> Claim | None:
    return next((c for c in findings.claims if c.metric == metric), None)


def detect_empty_specialists(
    bank_findings: AgentFindings, gst_findings: AgentFindings, investment_findings: AgentFindings
) -> list[RiskFactor]:
    """Rule 0 (checked before the four cross-source rules above): a
    specialist that returned zero claims isn't "nothing to flag" - every
    rule above only fires on an `if claim and other_claim` pair, so a
    silent specialist just makes every rule involving it quietly never
    fire, and the decision would read as a clean approval that in fact
    never examined that source. This is the one failure mode synthetic
    demo data can never exercise (every planted case has real non-empty
    data by design) - it surfaces for real uploads whose extraction
    legitimately found nothing to cite (see each specialist's own
    instruction: "if a metric has no evidence, do not include it").

    Callers (orchestrator_agent.py) must treat a non-empty result as
    forcing manual_review, not just another soft risk factor - unlike
    Rule 4's insurance_coverage_gap, this isn't a judgement call."""
    return [
        RiskFactor(
            rule=EMPTY_SPECIALIST_RULE,
            metric=f"{source}_empty",
            finding=(
                f"The specialist reading {source.replace('_findings', '')} data returned no "
                "findings for this borrower - that source could not be examined."
            ),
            evidence=[Evidence(source=source)],
        )
        for source, findings in (
            ("bank_findings", bank_findings),
            ("gst_findings", gst_findings),
            ("investment_findings", investment_findings),
        )
        if not findings.claims
    ]


def evaluate_rules(
    bank_findings: AgentFindings,
    gst_findings: AgentFindings,
    investment_findings: AgentFindings,
    declared_vs_actual: dict,
    loan_amount_requested: float,
) -> tuple[list[Contradiction], list[RiskFactor]]:
    contradictions: list[Contradiction] = []
    risk_factors: list[RiskFactor] = []

    # Rule 1: income vs. revenue divergence.
    income = _get_claim(bank_findings, "income_trend")
    revenue = _get_claim(gst_findings, "revenue_trend")
    if income and revenue and income.value in ("stable", "rising") and revenue.value == "declining":
        contradictions.append(
            Contradiction(
                rule="income_vs_revenue_divergence",
                metric="income_vs_revenue",
                finding=(
                    f"Bank shows {income.value} income "
                    f"({income.magnitude_pct:+.1f}%); GST shows declining revenue "
                    f"({revenue.magnitude_pct:+.1f}%)"
                ),
                evidence=[
                    Evidence(source="bank_findings", field="income_trend"),
                    Evidence(source="gst_findings", field="revenue_trend"),
                ],
                action="cap_confidence_0.5",
            )
        )

    # Rule 2: declared vs. actual mismatch (cross-source, computed once by
    # the orchestrator via tools.compute_declared_vs_actual_gap - not a
    # single sub-agent's claim, since it needs both bank and GST raw data).
    if declared_vs_actual and declared_vs_actual["gap_pct"] > DECLARED_VS_ACTUAL_GAP_PCT:
        contradictions.append(
            Contradiction(
                rule="declared_vs_actual_mismatch",
                metric="declared_vs_actual_gap",
                finding=(
                    f"Declared GST turnover ({declared_vs_actual['declared_turnover_total']}) "
                    f"vs. actual bank credits ({declared_vs_actual['actual_credits_total']}) "
                    f"diverge by {declared_vs_actual['gap_pct']:.1f}%"
                ),
                evidence=[
                    Evidence(source="gst_findings", field="declared_turnover", period=p)
                    for p in declared_vs_actual["evidence_periods"]
                ]
                + [
                    Evidence(source="bank_findings", field="total_credits", transaction_ids=[
                        t for t in declared_vs_actual["evidence_transaction_ids"]
                    ])
                ],
                action="request_manual_review",
            )
        )

    # Rule 3: asset cushion vs. cash flow. We have no explicit "drawdown"
    # metric in this schema, so "no drawdown evidence" is read as: the
    # liquid-assets claim itself carries no drawdown note, which holds
    # whenever the claim is simply "high" (see tools.compute_liquid_assets).
    liquid_assets = _get_claim(investment_findings, "liquid_assets")
    volatility = _get_claim(bank_findings, "cash_flow_volatility")
    if liquid_assets and volatility and liquid_assets.value == "high" and volatility.value == "high":
        contradictions.append(
            Contradiction(
                rule="asset_cushion_vs_cash_flow",
                metric="liquid_assets_vs_cash_flow_volatility",
                finding=(
                    "High month-to-month cash-flow volatility claimed alongside a "
                    "high liquid-asset cushion, with no drawdown evidence in the "
                    "investment data to explain the gap"
                ),
                evidence=[
                    Evidence(source="investment_findings", field="liquid_assets"),
                    Evidence(source="bank_findings", field="cash_flow_volatility"),
                ],
                action="flag_contradiction",
            )
        )

    # Rule 4: insurance coverage gap - a risk factor, not a hard contradiction.
    coverage = _get_claim(investment_findings, "insurance_coverage")
    if coverage and coverage.value == "gap":
        risk_factors.append(
            RiskFactor(
                rule="insurance_coverage_gap",
                metric="insurance_coverage",
                finding=(
                    f"Insurance coverage is well below the requested loan amount "
                    f"of {loan_amount_requested}"
                ),
                evidence=[Evidence(source="investment_findings", field="insurance_coverage")],
            )
        )

    return contradictions, risk_factors
