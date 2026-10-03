"""Tests for the 5 new edge-case synthetic borrowers (Part A of the
landing-page + edge-cases brief). Covers: schema-valid data, unique ids
(no collisions with the 3 original cases or each other), and consent dates
landing in the decay zone they were designed for - all offline, no
Firestore or Vertex AI needed."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.consent import confidence_multiplier, days_remaining
from agents.rules import evaluate_rules
from agents.schemas import AgentFindings, Claim, Evidence
from agents.tools import (
    compute_cash_flow_volatility,
    compute_declared_vs_actual_gap,
    compute_filing_consistency,
    compute_income_trend,
    compute_insurance_coverage,
    compute_liquid_assets,
    compute_revenue_trend,
)
from data.synthetic.borrowers import ALL_BORROWERS, CORE_BORROWER_IDS, EDGE_BORROWER_IDS

NEW_BORROWER_IDS = ["b_freelancer", "b_roundtrip", "b_closing_consent", "b_seasonal", "b_double_flag"]
REQUIRED_SOURCE_KEYS = {"DEPOSIT", "GSTR1_3B", "MUTUAL_FUNDS", "INSURANCE_POLICIES"}
FIXED_NOW = datetime(2026, 10, 10, 12, 0, 0, tzinfo=timezone.utc)


def test_all_8_cases_registered():
    assert set(ALL_BORROWERS.keys()) == set(CORE_BORROWER_IDS) | set(EDGE_BORROWER_IDS)
    assert len(ALL_BORROWERS) == 8
    assert set(NEW_BORROWER_IDS) == set(EDGE_BORROWER_IDS)


def test_borrower_ids_unique_and_match_dict_key():
    for borrower_id, builder in ALL_BORROWERS.items():
        data = builder(FIXED_NOW)
        assert data["borrower_id"] == borrower_id


def test_transaction_and_policy_ids_globally_unique():
    seen_txn_ids: set[str] = set()
    seen_policy_ids: set[str] = set()
    for builder in ALL_BORROWERS.values():
        data = builder(FIXED_NOW)
        for t in data["sources"]["DEPOSIT"]["transactions"]:
            assert t["txn_id"] not in seen_txn_ids, f"duplicate txn_id across borrowers: {t['txn_id']}"
            seen_txn_ids.add(t["txn_id"])
        for p in data["sources"]["INSURANCE_POLICIES"]["policies"]:
            assert p["policy_id"] not in seen_policy_ids, f"duplicate policy_id across borrowers: {p['policy_id']}"
            seen_policy_ids.add(p["policy_id"])


def _assert_schema_valid(data: dict) -> None:
    assert isinstance(data["borrower_id"], str) and data["borrower_id"]
    assert isinstance(data["display_name"], str) and data["display_name"]
    assert isinstance(data["loan_amount_requested"], (int, float)) and data["loan_amount_requested"] > 0

    sources = data["sources"]
    assert REQUIRED_SOURCE_KEYS.issubset(sources.keys()), f"missing sources: {REQUIRED_SOURCE_KEYS - sources.keys()}"

    deposit = sources["DEPOSIT"]
    assert deposit["fi_type"] == "DEPOSIT"
    assert len(deposit["transactions"]) >= 2
    for t in deposit["transactions"]:
        assert t["type"] in ("CREDIT", "DEBIT")
        assert t["amount"] > 0
        assert t["date"]

    gst = sources["GSTR1_3B"]
    assert gst["fi_type"] == "GSTR1_3B"
    assert len(gst["returns"]) >= 2
    for r in gst["returns"]:
        assert r["declared_turnover"] >= 0
        assert isinstance(r["filed_on_time"], bool)

    mf = sources["MUTUAL_FUNDS"]
    assert mf["fi_type"] == "MUTUAL_FUNDS"
    assert "total_current_value" in mf["summary"]

    insurance = sources["INSURANCE_POLICIES"]
    assert insurance["fi_type"] == "INSURANCE_POLICIES"
    assert "total_sum_assured" in insurance["summary"]

    consent = data["consent"]
    for key in ("bank_findings", "gst_findings", "investment_findings"):
        assert key in consent
        assert "expires_at" in consent[key]

    # Every deterministic tool must run against this data without raising -
    # the exact same calls the real specialist agents make.
    compute_income_trend(deposit["transactions"])
    compute_cash_flow_volatility(deposit["transactions"])
    compute_revenue_trend(gst["returns"])
    compute_filing_consistency(gst["returns"])
    compute_declared_vs_actual_gap(gst["returns"], deposit["transactions"])
    compute_liquid_assets(mf)
    compute_insurance_coverage(insurance, data["loan_amount_requested"])


def test_all_8_cases_schema_valid():
    for builder in ALL_BORROWERS.values():
        _assert_schema_valid(builder(FIXED_NOW))


def _claim(metric: str, value: str, magnitude_pct: float | None = None, confidence: float = 0.85) -> Claim:
    return Claim(metric=metric, value=value, magnitude_pct=magnitude_pct, evidence=[Evidence(field=metric)], confidence=confidence)


def _rules_result_for(data: dict) -> tuple[list, list]:
    bank = data["sources"]["DEPOSIT"]["transactions"]
    gst = data["sources"]["GSTR1_3B"]["returns"]
    mf = data["sources"]["MUTUAL_FUNDS"]
    insurance = data["sources"]["INSURANCE_POLICIES"]
    loan_amount = data["loan_amount_requested"]

    income = compute_income_trend(bank)
    volatility = compute_cash_flow_volatility(bank)
    revenue = compute_revenue_trend(gst)
    liquid = compute_liquid_assets(mf)
    coverage = compute_insurance_coverage(insurance, loan_amount)
    gap = compute_declared_vs_actual_gap(gst, bank)

    bank_findings = AgentFindings(
        agent="bank_statement_agent", borrower_id=data["borrower_id"],
        claims=[_claim("income_trend", income["value"], income["magnitude_pct"]), _claim("cash_flow_volatility", volatility["value"])],
    )
    gst_findings = AgentFindings(
        agent="gst_tax_agent", borrower_id=data["borrower_id"],
        claims=[_claim("revenue_trend", revenue["value"], revenue["magnitude_pct"])],
    )
    investment_findings = AgentFindings(
        agent="investment_agent", borrower_id=data["borrower_id"],
        claims=[_claim("liquid_assets", liquid["value"]), _claim("insurance_coverage", coverage["value"])],
    )
    return evaluate_rules(bank_findings, gst_findings, investment_findings, gap, loan_amount)


def test_b_freelancer_triggers_no_rules():
    contradictions, risk_factors = _rules_result_for(ALL_BORROWERS["b_freelancer"](FIXED_NOW))
    assert contradictions == [] and risk_factors == []


def test_b_roundtrip_triggers_declared_vs_actual_not_divergence():
    contradictions, risk_factors = _rules_result_for(ALL_BORROWERS["b_roundtrip"](FIXED_NOW))
    rules_fired = {c.rule for c in contradictions}
    assert "declared_vs_actual_mismatch" in rules_fired
    assert "income_vs_revenue_divergence" not in rules_fired


def test_b_closing_consent_triggers_no_rule_table_contradictions():
    contradictions, risk_factors = _rules_result_for(ALL_BORROWERS["b_closing_consent"](FIXED_NOW))
    assert contradictions == [] and risk_factors == []


def test_b_seasonal_triggers_income_vs_revenue_divergence_only():
    contradictions, risk_factors = _rules_result_for(ALL_BORROWERS["b_seasonal"](FIXED_NOW))
    rules_fired = {c.rule for c in contradictions}
    assert rules_fired == {"income_vs_revenue_divergence"}


def test_b_double_flag_triggers_divergence():
    contradictions, risk_factors = _rules_result_for(ALL_BORROWERS["b_double_flag"](FIXED_NOW))
    rules_fired = {c.rule for c in contradictions}
    assert "income_vs_revenue_divergence" in rules_fired


def test_b_closing_consent_bank_in_linear_decay_zone():
    data = ALL_BORROWERS["b_closing_consent"](FIXED_NOW)
    d = days_remaining(data["consent"]["bank_findings"]["expires_at"], now=FIXED_NOW)
    assert 0 < d <= 7, f"expected bank consent inside the 0<d<=7 decay zone, got {d} days"
    multiplier = confidence_multiplier(d)
    assert 0 < multiplier < 1.0


def test_b_double_flag_bank_in_decay_zone():
    data = ALL_BORROWERS["b_double_flag"](FIXED_NOW)
    d = days_remaining(data["consent"]["bank_findings"]["expires_at"], now=FIXED_NOW)
    assert d <= 7, f"expected bank consent at or inside the decay zone, got {d} days"


def test_other_new_cases_have_fresh_consent():
    for borrower_id in ("b_freelancer", "b_roundtrip", "b_seasonal"):
        data = ALL_BORROWERS[borrower_id](FIXED_NOW)
        for key in ("bank_findings", "gst_findings", "investment_findings"):
            d = days_remaining(data["consent"][key]["expires_at"], now=FIXED_NOW)
            assert d > 7, f"{borrower_id}.{key} expected fresh (>7 days) consent, got {d} days"


def test_b_seasonal_prior_year_reference_present_but_not_in_returns():
    data = ALL_BORROWERS["b_seasonal"](FIXED_NOW)
    gst = data["sources"]["GSTR1_3B"]
    assert "prior_year_reference" in gst
    assert len(gst["prior_year_reference"]) == 4
    # The prior-year data must never leak into the "returns" list the real
    # compute_revenue_trend()/compute_filing_consistency() actually read -
    # that's what keeps this a zero-code-change, outcome-preserving addition.
    returns_periods = {r["period"] for r in gst["returns"]}
    prior_year_periods = {r["period"] for r in gst["prior_year_reference"]}
    assert returns_periods.isdisjoint(prior_year_periods)
    assert all(p.startswith("2026-") for p in returns_periods)
    assert all(p.startswith("2025-") for p in prior_year_periods)
