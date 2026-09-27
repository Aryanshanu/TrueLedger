"""The three deliberately-planted demo borrowers.

Per the build brief: "plant these three deliberately, don't leave it to
random generation." Every FI-type JSON here follows the AA/Setu three-part
shape (profile / summary / transactions-or-equivalent) documented in
docs/DATA_SCHEMA.md. This is synthetic data only - see the disclosure notes
in README.md and docs/DATA_SCHEMA.md; no real Account Aggregator, Sahamati,
or FIP integration is involved anywhere in this repo.

    b_clean          - all three sources agree, healthy signals, fresh consent.
    b_contradiction  - bank income +2.1% (stable) vs GST revenue -11%
                        (declining): the demo's centerpiece contradiction,
                        matching the worked example in docs/DATA_SCHEMA.md.
    b_stale_consent  - otherwise healthy, but the bank source's consent has
                        2 days left, to demonstrate confidence decay.

Consent `expires_at` timestamps are computed relative to `now` at call time
(not baked into the committed JSON as fixed dates), so re-seeding the demo
on a later date still produces "30 days left" / "2 days left" as intended.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _deposit_source(transactions: list[dict], account_holder: str, current_balance: float) -> dict:
    return {
        "fi_type": "DEPOSIT",
        "profile": {
            "account_holder": account_holder,
            "account_number_masked": "XXXX1234",
            "bank": "Synthetic National Bank",
        },
        "summary": {"current_balance": current_balance, "currency": "INR"},
        "transactions": transactions,
    }


def _gst_source(gstin: str, legal_name: str, returns: list[dict]) -> dict:
    return {
        "fi_type": "GSTR1_3B",
        "profile": {"gstin": gstin, "legal_name": legal_name},
        "summary": {"filing_frequency": "monthly"},
        "returns": returns,
    }


def _mf_source(investor_name: str, holdings: list[dict]) -> dict:
    total_value = round(sum(h["current_value"] for h in holdings), 2)
    return {
        "fi_type": "MUTUAL_FUNDS",
        "profile": {"investor_name": investor_name},
        "summary": {"total_current_value": total_value},
        "holdings": holdings,
    }


def _insurance_source(policy_holder: str, policies: list[dict]) -> dict:
    total_sum_assured = round(sum(p["sum_assured"] for p in policies), 2)
    return {
        "fi_type": "INSURANCE_POLICIES",
        "profile": {"policy_holder": policy_holder},
        "summary": {"total_sum_assured": total_sum_assured},
        "policies": policies,
    }


def _consent_block(now: datetime, bank_days: int, gst_days: int, investment_days: int) -> dict:
    return {
        "bank_findings": {"fi_type": "DEPOSIT", "expires_at": _iso(now + timedelta(days=bank_days))},
        "gst_findings": {"fi_type": "GSTR1_3B", "expires_at": _iso(now + timedelta(days=gst_days))},
        "investment_findings": {
            "fi_type": "MUTUAL_FUNDS+INSURANCE_POLICIES",
            "expires_at": _iso(now + timedelta(days=investment_days)),
        },
    }


def build_b_clean(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    bank_txns = [
        {"txn_id": "txn_c101", "date": "2026-06-05", "amount": 200000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_c102", "date": "2026-06-20", "amount": 150000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_c103", "date": "2026-07-05", "amount": 206000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_c104", "date": "2026-07-20", "amount": 152000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_c105", "date": "2026-08-05", "amount": 214000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_c106", "date": "2026-08-20", "amount": 155000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_c107", "date": "2026-09-05", "amount": 222000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_c108", "date": "2026-09-20", "amount": 158000.0, "type": "DEBIT", "narration": "Supplier payment"},
    ]
    gst_returns = [
        {"period": "2026-06", "declared_turnover": 195000.0, "filed_on_time": True},
        {"period": "2026-07", "declared_turnover": 200000.0, "filed_on_time": True},
        {"period": "2026-08", "declared_turnover": 205000.0, "filed_on_time": True},
        {"period": "2026-09", "declared_turnover": 210000.0, "filed_on_time": True},
    ]
    mf_holdings = [
        {"scheme": "Synthetic Flexicap Fund", "units": 1200.0, "nav": 145.5, "current_value": 174600.0},
        {"scheme": "Synthetic Liquid Fund", "units": 3000.0, "nav": 25.13, "current_value": 75400.0},
    ]
    insurance_policies = [
        {"policy_id": "pol_c01", "type": "term_life", "sum_assured": 600000.0, "status": "active"},
    ]
    return {
        "borrower_id": "b_clean",
        "display_name": "Clean approve - all sources agree",
        "loan_amount_requested": 400000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Asha Traders", 312000.0),
            "GSTR1_3B": _gst_source("29AASHA1234B1Z5", "Asha Traders", gst_returns),
            "MUTUAL_FUNDS": _mf_source("Asha Traders", mf_holdings),
            "INSURANCE_POLICIES": _insurance_source("Asha Traders", insurance_policies),
        },
        "consent": _consent_block(now, bank_days=30, gst_days=30, investment_days=30),
    }


def build_b_contradiction(now: datetime | None = None) -> dict:
    """Bank +2.1% (stable) vs GST -11% (declining) - see docs/DATA_SCHEMA.md
    for the exact arithmetic this reproduces."""
    now = now or datetime.now(timezone.utc)
    bank_txns = [
        {"txn_id": "txn_881", "date": "2026-06-05", "amount": 163000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_882", "date": "2026-06-22", "amount": 120000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_890", "date": "2026-07-05", "amount": 167000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_891", "date": "2026-07-22", "amount": 125000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_901", "date": "2026-08-05", "amount": 168000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_899", "date": "2026-08-22", "amount": 127000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_902", "date": "2026-09-05", "amount": 168930.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_903", "date": "2026-09-22", "amount": 128000.0, "type": "DEBIT", "narration": "Supplier payment"},
    ]
    gst_returns = [
        {"period": "2026-06", "declared_turnover": 178000.0, "filed_on_time": True},
        {"period": "2026-07", "declared_turnover": 182000.0, "filed_on_time": True},
        {"period": "2026-08", "declared_turnover": 159000.0, "filed_on_time": True},
        {"period": "2026-09", "declared_turnover": 161400.0, "filed_on_time": True},
    ]
    mf_holdings = [
        {"scheme": "Synthetic Flexicap Fund", "units": 900.0, "nav": 130.0, "current_value": 117000.0},
        {"scheme": "Synthetic Liquid Fund", "units": 2500.0, "nav": 25.2, "current_value": 63000.0},
    ]
    insurance_policies = [
        {"policy_id": "pol_x01", "type": "term_life", "sum_assured": 600000.0, "status": "active"},
    ]
    return {
        "borrower_id": "b_contradiction",
        "display_name": "Contradiction - bank stable, GST revenue declining",
        "loan_amount_requested": 500000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Ramesh Kumar", 210000.0),
            "GSTR1_3B": _gst_source("07RAMES5678C1Z2", "Ramesh Kumar Enterprises", gst_returns),
            "MUTUAL_FUNDS": _mf_source("Ramesh Kumar", mf_holdings),
            "INSURANCE_POLICIES": _insurance_source("Ramesh Kumar", insurance_policies),
        },
        "consent": _consent_block(now, bank_days=30, gst_days=30, investment_days=30),
    }


def build_b_stale_consent(now: datetime | None = None) -> dict:
    """Otherwise healthy (same shape as b_clean); bank consent has 2 days left."""
    now = now or datetime.now(timezone.utc)
    base = build_b_clean(now)
    bank_txns = [dict(t, txn_id=t["txn_id"].replace("txn_c", "txn_s")) for t in base["sources"]["DEPOSIT"]["transactions"]]

    return {
        "borrower_id": "b_stale_consent",
        "display_name": "Healthy, but bank consent expiring in 2 days",
        "loan_amount_requested": 400000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Priya Nair", 312000.0),
            "GSTR1_3B": _gst_source("32PRIYA9012D1Z8", "Priya Nair", base["sources"]["GSTR1_3B"]["returns"]),
            "MUTUAL_FUNDS": _mf_source("Priya Nair", base["sources"]["MUTUAL_FUNDS"]["holdings"]),
            "INSURANCE_POLICIES": _insurance_source("Priya Nair", base["sources"]["INSURANCE_POLICIES"]["policies"]),
        },
        # Bank consent close to expiry -> confidence decay + re-consent prompt.
        "consent": _consent_block(now, bank_days=2, gst_days=30, investment_days=30),
    }


ALL_BORROWERS = {
    "b_clean": build_b_clean,
    "b_contradiction": build_b_contradiction,
    "b_stale_consent": build_b_stale_consent,
}
