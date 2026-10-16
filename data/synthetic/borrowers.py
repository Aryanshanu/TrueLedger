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
    """Otherwise healthy (same shape as b_clean); bank consent already expired.

    bank_days=-3 (expired 3 days ago) rather than a small positive number so
    that c(d)=0 is guaranteed at any seed time - no race between when you
    seed and when you capture. The case note ("Consent expired") and README
    outcome (decline, 0.00) both require an expired consent, not a near-expiry
    one; b_closing_consent covers the near-expiry / partial-decay demo.
    """
    now = now or datetime.now(timezone.utc)
    base = build_b_clean(now)
    bank_txns = [dict(t, txn_id=t["txn_id"].replace("txn_c", "txn_s")) for t in base["sources"]["DEPOSIT"]["transactions"]]
    policies = [dict(p, policy_id=p["policy_id"].replace("pol_c", "pol_s")) for p in base["sources"]["INSURANCE_POLICIES"]["policies"]]

    return {
        "borrower_id": "b_stale_consent",
        "display_name": "Healthy, but bank consent expired 3 days ago",
        "loan_amount_requested": 400000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Priya Nair", 312000.0),
            "GSTR1_3B": _gst_source("32PRIYA9012D1Z8", "Priya Nair", base["sources"]["GSTR1_3B"]["returns"]),
            "MUTUAL_FUNDS": _mf_source("Priya Nair", base["sources"]["MUTUAL_FUNDS"]["holdings"]),
            "INSURANCE_POLICIES": _insurance_source("Priya Nair", policies),
        },
        "consent": _consent_block(now, bank_days=-3, gst_days=30, investment_days=30),
    }


def build_b_freelancer(now: datetime | None = None) -> dict:
    """Freelance consultant, GST-registered, thin bureau file (small SIP,
    not a large investment portfolio), steady client payouts. All sources
    agree - no contradiction, no risk factor, fresh consent throughout."""
    now = now or datetime.now(timezone.utc)
    bank_txns = [
        {"txn_id": "txn_fl101", "date": "2026-06-05", "amount": 48000.0, "type": "CREDIT", "narration": "Client payout - Project Alpha"},
        {"txn_id": "txn_fl102", "date": "2026-06-18", "amount": 15000.0, "type": "DEBIT", "narration": "Business expenses"},
        {"txn_id": "txn_fl103", "date": "2026-07-05", "amount": 49500.0, "type": "CREDIT", "narration": "Client payout - Project Beta"},
        {"txn_id": "txn_fl104", "date": "2026-07-18", "amount": 15500.0, "type": "DEBIT", "narration": "Business expenses"},
        {"txn_id": "txn_fl105", "date": "2026-08-05", "amount": 50500.0, "type": "CREDIT", "narration": "Client payout - Project Gamma"},
        {"txn_id": "txn_fl106", "date": "2026-08-18", "amount": 16000.0, "type": "DEBIT", "narration": "Business expenses"},
        {"txn_id": "txn_fl107", "date": "2026-09-05", "amount": 51000.0, "type": "CREDIT", "narration": "Client payout - Project Delta"},
        {"txn_id": "txn_fl108", "date": "2026-09-18", "amount": 16200.0, "type": "DEBIT", "narration": "Business expenses"},
    ]
    gst_returns = [
        {"period": "2026-06", "declared_turnover": 46000.0, "filed_on_time": True},
        {"period": "2026-07", "declared_turnover": 47000.0, "filed_on_time": True},
        {"period": "2026-08", "declared_turnover": 48000.0, "filed_on_time": True},
        {"period": "2026-09", "declared_turnover": 49000.0, "filed_on_time": True},
    ]
    mf_holdings = [
        {"scheme": "Synthetic SIP Growth Fund", "units": 400.0, "nav": 110.0, "current_value": 44000.0},
    ]
    insurance_policies = [
        {"policy_id": "pol_fl01", "type": "term_life", "sum_assured": 200000.0, "status": "active"},
    ]
    return {
        "borrower_id": "b_freelancer",
        "display_name": "Freelance consultant - thin file, small SIP, all sources agree",
        "loan_amount_requested": 150000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Kavya Iyer", 95000.0),
            "GSTR1_3B": _gst_source("29KAVYA5566E1Z4", "Kavya Iyer Consulting", gst_returns),
            "MUTUAL_FUNDS": _mf_source("Kavya Iyer", mf_holdings),
            "INSURANCE_POLICIES": _insurance_source("Kavya Iyer", insurance_policies),
        },
        "consent": _consent_block(now, bank_days=30, gst_days=30, investment_days=30),
    }


def build_b_roundtrip(now: datetime | None = None) -> dict:
    """Kirana shop owner: bank deposits surge while declared GST turnover
    stays flat. income_vs_revenue_divergence does NOT fire here (it only
    fires when GST is *declining*, not flat) - this instead triggers
    declared_vs_actual_mismatch (actual bank credits vs. declared turnover,
    gap well over the 15% threshold), the classic under-reporting pattern a
    "deposits surge, declared revenue doesn't move" story actually matches."""
    now = now or datetime.now(timezone.utc)
    bank_txns = [
        {"txn_id": "txn_rt101", "date": "2026-06-05", "amount": 70000.0, "type": "CREDIT", "narration": "Counter sales"},
        {"txn_id": "txn_rt102", "date": "2026-06-20", "amount": 42000.0, "type": "DEBIT", "narration": "Stock purchase"},
        {"txn_id": "txn_rt103", "date": "2026-07-05", "amount": 95000.0, "type": "CREDIT", "narration": "Counter sales"},
        {"txn_id": "txn_rt104", "date": "2026-07-20", "amount": 57000.0, "type": "DEBIT", "narration": "Stock purchase"},
        {"txn_id": "txn_rt105", "date": "2026-08-05", "amount": 120000.0, "type": "CREDIT", "narration": "Counter sales"},
        {"txn_id": "txn_rt106", "date": "2026-08-20", "amount": 72000.0, "type": "DEBIT", "narration": "Stock purchase"},
        {"txn_id": "txn_rt107", "date": "2026-09-05", "amount": 150000.0, "type": "CREDIT", "narration": "Counter sales"},
        {"txn_id": "txn_rt108", "date": "2026-09-20", "amount": 90000.0, "type": "DEBIT", "narration": "Stock purchase"},
    ]
    gst_returns = [
        {"period": "2026-06", "declared_turnover": 68000.0, "filed_on_time": True},
        {"period": "2026-07", "declared_turnover": 69000.0, "filed_on_time": True},
        {"period": "2026-08", "declared_turnover": 69500.0, "filed_on_time": True},
        {"period": "2026-09", "declared_turnover": 70000.0, "filed_on_time": True},
    ]
    mf_holdings = [
        {"scheme": "Synthetic Liquid Fund", "units": 2200.0, "nav": 25.5, "current_value": 56100.0},
    ]
    insurance_policies = [
        {"policy_id": "pol_rt01", "type": "term_life", "sum_assured": 350000.0, "status": "active"},
    ]
    return {
        "borrower_id": "b_roundtrip",
        "display_name": "Kirana shop owner - deposits surge, declared GST turnover stays flat",
        "loan_amount_requested": 300000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Suresh Patil", 180000.0),
            "GSTR1_3B": _gst_source("27SURES3344F1Z1", "Patil General Store", gst_returns),
            "MUTUAL_FUNDS": _mf_source("Suresh Patil", mf_holdings),
            "INSURANCE_POLICIES": _insurance_source("Suresh Patil", insurance_policies),
        },
        "consent": _consent_block(now, bank_days=30, gst_days=30, investment_days=30),
    }


def build_b_closing_consent(now: datetime | None = None) -> dict:
    """All sources agree (same healthy shape as b_clean); bank consent
    closes in ~3 days - still inside the 0<d<=7 linear decay zone, NOT yet
    expired (c(d)=d/7, not 0). Demonstrates the gradual decay zone as
    distinct from b_stale_consent, which (per the real captured run) had
    already drifted past zero by the time it was actually captured - the
    exact timing risk this case has to watch for too. Seed and capture in
    the same sitting; the longer the gap, the more "~3 days left" drifts
    toward (or past) expired by the time you actually run the capture."""
    now = now or datetime.now(timezone.utc)
    base = build_b_clean(now)
    bank_txns = [dict(t, txn_id=t["txn_id"].replace("txn_c", "txn_cc")) for t in base["sources"]["DEPOSIT"]["transactions"]]
    policies = [dict(p, policy_id=p["policy_id"].replace("pol_c", "pol_cc")) for p in base["sources"]["INSURANCE_POLICIES"]["policies"]]

    return {
        "borrower_id": "b_closing_consent",
        "display_name": "Healthy, but bank consent closes in ~3 days (linear decay zone)",
        "loan_amount_requested": 400000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Farah Sheikh", 312000.0),
            "GSTR1_3B": _gst_source("24FARAH7788G1Z6", "Farah Sheikh", base["sources"]["GSTR1_3B"]["returns"]),
            "MUTUAL_FUNDS": _mf_source("Farah Sheikh", base["sources"]["MUTUAL_FUNDS"]["holdings"]),
            "INSURANCE_POLICIES": _insurance_source("Farah Sheikh", policies),
        },
        "consent": _consent_block(now, bank_days=3, gst_days=30, investment_days=30),
    }


def build_b_seasonal(now: datetime | None = None) -> dict:
    """Sweet shop: GST declines in the low season while bank stays stable -
    mechanically the same income_vs_revenue_divergence rule as
    b_contradiction, different narrative. The GSTR1_3B source also carries a
    "prior_year_reference" sibling field (last year's same four months,
    a near-identical dip) - present in the real synthetic data and
    inspectable by opening the raw JSON/Firestore record, but NOT read by
    compute_revenue_trend (which only ever reads the "returns" key) and NOT
    surfaced through the Desk's ledger evidence chips (those only show what
    the agent actually cited). This is deliberate: it keeps the outcome
    identical to a plain divergence case (no code path changed to make an
    LLM "recognize" seasonality) while still making the recurring pattern
    real and findable for anyone who looks at the underlying data."""
    now = now or datetime.now(timezone.utc)
    bank_txns = [
        {"txn_id": "txn_se101", "date": "2026-06-05", "amount": 150000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_se102", "date": "2026-06-20", "amount": 90000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_se103", "date": "2026-07-05", "amount": 148000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_se104", "date": "2026-07-20", "amount": 89000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_se105", "date": "2026-08-05", "amount": 149000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_se106", "date": "2026-08-20", "amount": 89500.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_se107", "date": "2026-09-05", "amount": 151000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_se108", "date": "2026-09-20", "amount": 90500.0, "type": "DEBIT", "narration": "Supplier payment"},
    ]
    gst_returns = [
        {"period": "2026-06", "declared_turnover": 150000.0, "filed_on_time": True},
        {"period": "2026-07", "declared_turnover": 138000.0, "filed_on_time": True},
        {"period": "2026-08", "declared_turnover": 128000.0, "filed_on_time": True},
        {"period": "2026-09", "declared_turnover": 120000.0, "filed_on_time": True},
    ]
    prior_year_reference = [
        {"period": "2025-06", "declared_turnover": 152000.0, "filed_on_time": True},
        {"period": "2025-07", "declared_turnover": 140000.0, "filed_on_time": True},
        {"period": "2025-08", "declared_turnover": 130000.0, "filed_on_time": True},
        {"period": "2025-09", "declared_turnover": 121000.0, "filed_on_time": True},
    ]
    mf_holdings = [
        {"scheme": "Synthetic Liquid Fund", "units": 2400.0, "nav": 25.0, "current_value": 60000.0},
    ]
    insurance_policies = [
        {"policy_id": "pol_se01", "type": "term_life", "sum_assured": 400000.0, "status": "active"},
    ]
    gst_source = _gst_source("27MISHRA9900H1Z3", "Mishra Sweets", gst_returns)
    gst_source["prior_year_reference"] = prior_year_reference
    return {
        "borrower_id": "b_seasonal",
        "display_name": "Sweet shop - GST dips in the low season, bank stays stable",
        "loan_amount_requested": 350000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Mishra Sweets", 220000.0),
            "GSTR1_3B": gst_source,
            "MUTUAL_FUNDS": _mf_source("Mishra Sweets", mf_holdings),
            "INSURANCE_POLICIES": _insurance_source("Mishra Sweets", insurance_policies),
        },
        "consent": _consent_block(now, bank_days=30, gst_days=30, investment_days=30),
    }


def build_b_double_flag(now: datetime | None = None) -> dict:
    """Textile trader: income_vs_revenue_divergence AND bank consent
    closing together - the same timing caveat as b_closing_consent applies
    (seed and capture close together, or "closing" may drift to "expired"
    by the time you actually run the capture)."""
    now = now or datetime.now(timezone.utc)
    bank_txns = [
        {"txn_id": "txn_df101", "date": "2026-06-05", "amount": 185000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_df102", "date": "2026-06-22", "amount": 135000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_df103", "date": "2026-07-05", "amount": 188000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_df104", "date": "2026-07-22", "amount": 138000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_df105", "date": "2026-08-05", "amount": 190000.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_df106", "date": "2026-08-22", "amount": 140000.0, "type": "DEBIT", "narration": "Supplier payment"},
        {"txn_id": "txn_df107", "date": "2026-09-05", "amount": 191500.0, "type": "CREDIT", "narration": "Business receipts"},
        {"txn_id": "txn_df108", "date": "2026-09-22", "amount": 141000.0, "type": "DEBIT", "narration": "Supplier payment"},
    ]
    gst_returns = [
        {"period": "2026-06", "declared_turnover": 200000.0, "filed_on_time": True},
        {"period": "2026-07", "declared_turnover": 185000.0, "filed_on_time": True},
        {"period": "2026-08", "declared_turnover": 170000.0, "filed_on_time": True},
        {"period": "2026-09", "declared_turnover": 165000.0, "filed_on_time": True},
    ]
    mf_holdings = [
        {"scheme": "Synthetic Liquid Fund", "units": 2800.0, "nav": 25.0, "current_value": 70000.0},
    ]
    insurance_policies = [
        {"policy_id": "pol_df01", "type": "term_life", "sum_assured": 650000.0, "status": "active"},
    ]
    return {
        "borrower_id": "b_double_flag",
        "display_name": "Textile trader - bank/GST divergence and bank consent closing together",
        "loan_amount_requested": 600000.0,
        "sources": {
            "DEPOSIT": _deposit_source(bank_txns, "Vikram Chawla", 260000.0),
            "GSTR1_3B": _gst_source("06VIKRA1122J1Z9", "Chawla Textiles", gst_returns),
            "MUTUAL_FUNDS": _mf_source("Vikram Chawla", mf_holdings),
            "INSURANCE_POLICIES": _insurance_source("Vikram Chawla", insurance_policies),
        },
        "consent": _consent_block(now, bank_days=2, gst_days=30, investment_days=30),
    }


ALL_BORROWERS = {
    "b_clean": build_b_clean,
    "b_contradiction": build_b_contradiction,
    "b_stale_consent": build_b_stale_consent,
    "b_freelancer": build_b_freelancer,
    "b_roundtrip": build_b_roundtrip,
    "b_closing_consent": build_b_closing_consent,
    "b_seasonal": build_b_seasonal,
    "b_double_flag": build_b_double_flag,
}

CORE_BORROWER_IDS = ["b_clean", "b_contradiction", "b_stale_consent"]
EDGE_BORROWER_IDS = ["b_freelancer", "b_roundtrip", "b_closing_consent", "b_seasonal", "b_double_flag"]
