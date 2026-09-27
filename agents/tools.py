"""Deterministic metric computation.

These are plain, pure Python functions - no LLM involved. Each specialist
sub-agent calls the matching Firestore-backed wrapper (see bank_agent.py,
gst_agent.py, investment_agent.py) as an ADK tool; the wrapper fetches this
borrower's FI-schema JSON from Firestore and calls straight through to a
function here. The model then only has to translate the returned dict into
a cited Claim (schemas.Claim) - it is never allowed to compute a sum,
average, or trend itself, so it cannot hallucinate a number.

Every function returns evidence (transaction_ids and/or the exact filing
period) pointing back to the raw records the number came from, because that
per-metric citation is what makes the orchestrator's cross-checking and the
replay UI's click-through possible.
"""

from __future__ import annotations

import statistics
from typing import Literal

from agents.config import TREND_STABLE_BAND_PCT

Trend = Literal["rising", "declining", "stable"]


def _classify_trend(pct_change: float) -> Trend:
    if pct_change > TREND_STABLE_BAND_PCT:
        return "rising"
    if pct_change < -TREND_STABLE_BAND_PCT:
        return "declining"
    return "stable"


def _split_halves(items: list[dict], sort_key):
    ordered = sorted(items, key=sort_key)
    mid = len(ordered) // 2
    # An odd-length list keeps the extra item in the second (more recent) half.
    return ordered[:mid], ordered[mid:]


def compute_income_trend(transactions: list[dict]) -> dict:
    """Bank statement agent: income stability from CREDIT transactions."""
    credits = [t for t in transactions if t.get("type") == "CREDIT"]
    if len(credits) < 2:
        return {
            "metric": "income_trend",
            "value": "stable",
            "magnitude_pct": 0.0,
            "evidence_transaction_ids": [t["txn_id"] for t in credits],
            "period": None,
        }

    first_half, second_half = _split_halves(credits, sort_key=lambda t: t["date"])
    first_avg = sum(t["amount"] for t in first_half) / len(first_half)
    second_avg = sum(t["amount"] for t in second_half) / len(second_half)
    pct_change = 0.0 if first_avg == 0 else (second_avg - first_avg) / first_avg * 100

    return {
        "metric": "income_trend",
        "value": _classify_trend(pct_change),
        "magnitude_pct": round(pct_change, 2),
        "evidence_transaction_ids": [t["txn_id"] for t in second_half],
        "period": f"{first_half[0]['date'][:7]} to {second_half[-1]['date'][:7]}",
    }


def compute_cash_flow_volatility(transactions: list[dict]) -> dict:
    """Bank statement agent: coefficient-of-variation of monthly net cash flow."""
    monthly_net: dict[str, float] = {}
    for t in transactions:
        month = t["date"][:7]
        signed = t["amount"] if t.get("type") == "CREDIT" else -t["amount"]
        monthly_net[month] = monthly_net.get(month, 0.0) + signed

    values = list(monthly_net.values())
    if len(values) < 2:
        return {
            "metric": "cash_flow_volatility",
            "value": "low",
            "coefficient_of_variation": 0.0,
            "evidence_period": None,
        }

    mean = statistics.mean(values)
    stdev = statistics.pstdev(values)
    cov = 0.0 if mean == 0 else abs(stdev / mean)
    months = sorted(monthly_net.keys())

    return {
        "metric": "cash_flow_volatility",
        "value": "high" if cov > 0.5 else "low",
        "coefficient_of_variation": round(cov, 3),
        "evidence_period": f"{months[0]} to {months[-1]}",
    }


def compute_revenue_trend(returns: list[dict]) -> dict:
    """GST/tax agent: declared-turnover trend across filing periods."""
    if len(returns) < 2:
        return {
            "metric": "revenue_trend",
            "value": "stable",
            "magnitude_pct": 0.0,
            "evidence_periods": [r["period"] for r in returns],
        }

    first_half, second_half = _split_halves(returns, sort_key=lambda r: r["period"])
    first_avg = sum(r["declared_turnover"] for r in first_half) / len(first_half)
    second_avg = sum(r["declared_turnover"] for r in second_half) / len(second_half)
    pct_change = 0.0 if first_avg == 0 else (second_avg - first_avg) / first_avg * 100

    return {
        "metric": "revenue_trend",
        "value": _classify_trend(pct_change),
        "magnitude_pct": round(pct_change, 2),
        "evidence_periods": [r["period"] for r in second_half],
    }


def compute_filing_consistency(returns: list[dict]) -> dict:
    """GST/tax agent: fraction of periods filed on time."""
    if not returns:
        return {"metric": "filing_consistency", "value": "unknown", "ratio": None, "evidence_periods": []}
    on_time = [r for r in returns if r.get("filed_on_time")]
    late_periods = [r["period"] for r in returns if not r.get("filed_on_time")]
    ratio = len(on_time) / len(returns)
    return {
        "metric": "filing_consistency",
        "value": "consistent" if ratio == 1.0 else "irregular",
        "ratio": round(ratio, 2),
        "evidence_periods": late_periods or [r["period"] for r in returns],
    }


def compute_declared_vs_actual_gap(gst_returns: list[dict], bank_transactions: list[dict]) -> dict:
    """Cross-source input for the orchestrator's declared-vs-actual rule.

    Computed once, deterministically, here rather than left to the
    orchestrator's LLM pass, since it feeds a hard rule (>15% gap).
    """
    declared_total = sum(r["declared_turnover"] for r in gst_returns)
    actual_total = sum(t["amount"] for t in bank_transactions if t.get("type") == "CREDIT")
    gap_pct = 0.0 if declared_total == 0 else abs(actual_total - declared_total) / declared_total * 100

    return {
        "metric": "declared_vs_actual_gap",
        "declared_turnover_total": round(declared_total, 2),
        "actual_credits_total": round(actual_total, 2),
        "gap_pct": round(gap_pct, 2),
        "evidence_periods": [r["period"] for r in gst_returns],
        "evidence_transaction_ids": [t["txn_id"] for t in bank_transactions if t.get("type") == "CREDIT"],
    }


def compute_liquid_assets(mf_data: dict) -> dict:
    """Mutual fund/insurance agent: total liquid (MF) asset cushion."""
    holdings = mf_data.get("holdings", [])
    total_value = mf_data.get("summary", {}).get("total_current_value", 0.0)
    return {
        "metric": "liquid_assets",
        "value": "high" if total_value > 100_000 else "low",
        "total_current_value": total_value,
        "evidence_holdings": [h["scheme"] for h in holdings],
    }


def compute_insurance_coverage(insurance_data: dict, loan_amount_requested: float) -> dict:
    """Mutual fund/insurance agent: sum-assured coverage vs the requested loan."""
    policies = insurance_data.get("policies", [])
    total_sum_assured = insurance_data.get("summary", {}).get("total_sum_assured", 0.0)
    ratio = None if loan_amount_requested in (0, None) else total_sum_assured / loan_amount_requested

    if ratio is None:
        value = "unknown"
    elif ratio >= 1.0:
        value = "adequate"
    elif ratio >= 0.5:
        value = "borderline"
    else:
        value = "gap"

    return {
        "metric": "insurance_coverage",
        "value": value,
        "total_sum_assured": total_sum_assured,
        "loan_amount_requested": loan_amount_requested,
        "coverage_ratio": None if ratio is None else round(ratio, 3),
        "evidence_policy_ids": [p["policy_id"] for p in policies],
    }
