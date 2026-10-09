from agents import tools
from agents.rules import detect_empty_specialists, evaluate_rules
from agents.schemas import AgentFindings, Claim, Evidence
from data.synthetic.borrowers import build_b_clean, build_b_contradiction


def _claim(metric: str, value: str, magnitude_pct: float | None = None, confidence: float = 0.85) -> Claim:
    return Claim(metric=metric, value=value, magnitude_pct=magnitude_pct, evidence=[Evidence(field=metric)], confidence=confidence)


def _findings_for(borrower: dict) -> tuple[AgentFindings, AgentFindings, AgentFindings, dict]:
    bank = borrower["sources"]["DEPOSIT"]["transactions"]
    gst = borrower["sources"]["GSTR1_3B"]["returns"]
    mf = borrower["sources"]["MUTUAL_FUNDS"]
    insurance = borrower["sources"]["INSURANCE_POLICIES"]
    loan_amount = borrower["loan_amount_requested"]

    income = tools.compute_income_trend(bank)
    volatility = tools.compute_cash_flow_volatility(bank)
    revenue = tools.compute_revenue_trend(gst)
    liquid = tools.compute_liquid_assets(mf)
    coverage = tools.compute_insurance_coverage(insurance, loan_amount)
    gap = tools.compute_declared_vs_actual_gap(gst, bank)

    bank_findings = AgentFindings(
        agent="bank_statement_agent",
        borrower_id=borrower["borrower_id"],
        claims=[
            _claim("income_trend", income["value"], income["magnitude_pct"]),
            _claim("cash_flow_volatility", volatility["value"]),
        ],
    )
    gst_findings = AgentFindings(
        agent="gst_tax_agent",
        borrower_id=borrower["borrower_id"],
        claims=[_claim("revenue_trend", revenue["value"], revenue["magnitude_pct"])],
    )
    investment_findings = AgentFindings(
        agent="investment_agent",
        borrower_id=borrower["borrower_id"],
        claims=[
            _claim("liquid_assets", liquid["value"]),
            _claim("insurance_coverage", coverage["value"]),
        ],
    )
    return bank_findings, gst_findings, investment_findings, gap


def test_b_contradiction_flags_income_vs_revenue_and_caps_confidence():
    borrower = build_b_contradiction()
    bank_findings, gst_findings, investment_findings, gap = _findings_for(borrower)

    contradictions, risk_factors = evaluate_rules(
        bank_findings, gst_findings, investment_findings, gap, borrower["loan_amount_requested"]
    )

    rules_fired = {c.rule for c in contradictions}
    assert "income_vs_revenue_divergence" in rules_fired
    entry = next(c for c in contradictions if c.rule == "income_vs_revenue_divergence")
    assert entry.action == "cap_confidence_0.5"
    assert "stable" in entry.finding
    assert "-11" in entry.finding or "declining" in entry.finding


def test_b_clean_has_no_contradictions():
    borrower = build_b_clean()
    bank_findings, gst_findings, investment_findings, gap = _findings_for(borrower)

    contradictions, risk_factors = evaluate_rules(
        bank_findings, gst_findings, investment_findings, gap, borrower["loan_amount_requested"]
    )

    assert contradictions == []


def test_b_clean_has_no_empty_specialists():
    """All 8 planted cases have real, non-empty data for every source by
    design - detect_empty_specialists must never fire on them, or every
    one of them would unexpectedly flip to manual_review."""
    borrower = build_b_clean()
    bank_findings, gst_findings, investment_findings, gap = _findings_for(borrower)
    assert detect_empty_specialists(bank_findings, gst_findings, investment_findings) == []


def test_detect_empty_specialists_flags_each_silent_source_independently():
    empty = AgentFindings(agent="gst_tax_agent", borrower_id="b_test", claims=[])
    present = AgentFindings(
        agent="bank_statement_agent", borrower_id="b_test", claims=[_claim("income_trend", "stable", 0.0)]
    )

    only_gst_empty = detect_empty_specialists(present, empty, present)
    assert [r.rule for r in only_gst_empty] == ["specialist_produced_no_claims"]
    assert only_gst_empty[0].evidence[0].source == "gst_findings"

    all_empty = detect_empty_specialists(empty, empty, empty)
    assert len(all_empty) == 3
    assert {r.evidence[0].source for r in all_empty} == {"bank_findings", "gst_findings", "investment_findings"}

    none_empty = detect_empty_specialists(present, present, present)
    assert none_empty == []
