from datetime import datetime, timezone

from agents import tools
from agents.extraction import _to_source_shape, assemble_fi_data, build_consent_block, empty_source_stub


def test_to_source_shape_computes_mutual_fund_total():
    extracted = {
        "investor_name": "A. Sharma",
        "holdings": [{"scheme": "Fund A", "current_value": 60000.0}, {"scheme": "Fund B", "current_value": 45000.0}],
    }
    source = _to_source_shape("MUTUAL_FUNDS", extracted)
    assert source["summary"]["total_current_value"] == 105000.0
    assert source["fi_type"] == "MUTUAL_FUNDS"


def test_to_source_shape_computes_insurance_total_and_assigns_policy_ids():
    extracted = {"policy_holder": "A. Sharma", "policies": [{"sum_assured": 500000.0}, {"sum_assured": 200000.0}]}
    source = _to_source_shape("INSURANCE_POLICIES", extracted)
    assert source["summary"]["total_sum_assured"] == 700000.0
    assert [p["policy_id"] for p in source["policies"]] == ["up_pol_001", "up_pol_002"]


def test_to_source_shape_assigns_sequential_unique_txn_ids():
    extracted = {
        "account_holder": "A. Sharma",
        "current_balance": 10000.0,
        "transactions": [
            {"date": "2026-01-01", "amount": 5000.0, "type": "CREDIT", "narration": "x"},
            {"date": "2026-02-01", "amount": 4500.0, "type": "DEBIT", "narration": "y"},
        ],
    }
    source = _to_source_shape("DEPOSIT", extracted)
    ids = [t["txn_id"] for t in source["transactions"]]
    assert ids == ["up_txn_001", "up_txn_002"]
    assert len(set(ids)) == len(ids)


def test_empty_source_stub_never_crashes_the_deterministic_tools():
    """Every source the pipeline looks up with a hard `["X"]` key (never
    `.get`) must exist even when a document type wasn't uploaded - and the
    tools that read it must handle the resulting empty shape gracefully."""
    for doc_type in ("DEPOSIT", "GSTR1_3B", "MUTUAL_FUNDS", "INSURANCE_POLICIES"):
        source = _to_source_shape(doc_type, empty_source_stub(doc_type))
        assert source["fi_type"] == doc_type

    fi_data = assemble_fi_data({}, loan_amount_requested=100000.0)
    assert set(fi_data["sources"].keys()) == {"DEPOSIT", "GSTR1_3B", "MUTUAL_FUNDS", "INSURANCE_POLICIES"}

    assert tools.compute_income_trend(fi_data["sources"]["DEPOSIT"]["transactions"])["value"] == "stable"
    assert tools.compute_revenue_trend(fi_data["sources"]["GSTR1_3B"]["returns"])["value"] == "stable"
    assert tools.compute_liquid_assets(fi_data["sources"]["MUTUAL_FUNDS"])["value"] == "low"
    assert tools.compute_insurance_coverage(fi_data["sources"]["INSURANCE_POLICIES"], 100000.0)["value"] == "gap"


def test_assemble_fi_data_prefers_extracted_over_stub():
    deposit = _to_source_shape(
        "DEPOSIT", {"account_holder": "A", "current_balance": 1.0, "transactions": []}
    )
    fi_data = assemble_fi_data({"DEPOSIT": deposit, "GSTR1_3B": None, "MUTUAL_FUNDS": None, "INSURANCE_POLICIES": None}, 50000.0)
    assert fi_data["sources"]["DEPOSIT"] is deposit
    assert fi_data["loan_amount_requested"] == 50000.0


def test_build_consent_block_shape_and_window():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    consent = build_consent_block(now=now, days=90)
    assert set(consent.keys()) == {"bank_findings", "gst_findings", "investment_findings"}
    for meta in consent.values():
        assert meta["expires_at"] == "2026-04-01T00:00:00Z"
    assert consent["bank_findings"]["fi_type"] == "DEPOSIT"
    assert consent["gst_findings"]["fi_type"] == "GSTR1_3B"
    assert consent["investment_findings"]["fi_type"] == "MUTUAL_FUNDS+INSURANCE_POLICIES"
