from agents import tools
from data.synthetic.borrowers import build_b_clean, build_b_contradiction


def test_income_vs_revenue_matches_brief_worked_example():
    """docs/DATA_SCHEMA.md's worked example: bank +2.1% (stable), GST -11% (declining)."""
    data = build_b_contradiction()
    bank = data["sources"]["DEPOSIT"]["transactions"]
    gst = data["sources"]["GSTR1_3B"]["returns"]

    income = tools.compute_income_trend(bank)
    revenue = tools.compute_revenue_trend(gst)

    assert income["value"] == "stable"
    assert income["magnitude_pct"] == 2.1
    assert revenue["value"] == "declining"
    assert revenue["magnitude_pct"] == -11.0
    assert income["evidence_transaction_ids"], "trend claim must carry citable transaction ids"
    assert revenue["evidence_periods"], "trend claim must carry citable filing periods"


def test_b_clean_has_no_declared_vs_actual_gap():
    data = build_b_clean()
    gst = data["sources"]["GSTR1_3B"]["returns"]
    bank = data["sources"]["DEPOSIT"]["transactions"]
    gap = tools.compute_declared_vs_actual_gap(gst, bank)
    assert gap["gap_pct"] < 15.0


def test_insurance_coverage_classification():
    adequate = tools.compute_insurance_coverage({"summary": {"total_sum_assured": 600000}, "policies": []}, 400000)
    gap = tools.compute_insurance_coverage({"summary": {"total_sum_assured": 100000}, "policies": []}, 500000)
    assert adequate["value"] == "adequate"
    assert gap["value"] == "gap"


def test_liquid_assets_threshold():
    high = tools.compute_liquid_assets({"summary": {"total_current_value": 250000}, "holdings": []})
    low = tools.compute_liquid_assets({"summary": {"total_current_value": 50000}, "holdings": []})
    assert high["value"] == "high"
    assert low["value"] == "low"
