"""Generate (and self-verify) the three planted demo borrowers.

Usage (from repo root):
    python -m data.synthetic.generate

Writes data/synthetic/output/{borrower_id}.json for each borrower and
prints the deterministic metrics computed from that data, so a drifted
number is caught here instead of surfacing confusingly in a demo. To also
seed Firestore, use infra/seed_firestore.py (requires GOOGLE_CLOUD_PROJECT
and application-default credentials).
"""

from __future__ import annotations

import json
from pathlib import Path

from agents import tools
from data.synthetic.borrowers import ALL_BORROWERS

OUTPUT_DIR = Path(__file__).parent / "output"


def _self_check(borrower_id: str, data: dict) -> None:
    bank = data["sources"]["DEPOSIT"]["transactions"]
    gst = data["sources"]["GSTR1_3B"]["returns"]

    income = tools.compute_income_trend(bank)
    revenue = tools.compute_revenue_trend(gst)
    gap = tools.compute_declared_vs_actual_gap(gst, bank)
    volatility = tools.compute_cash_flow_volatility(bank)

    print(f"[{borrower_id}] income_trend={income['value']} ({income['magnitude_pct']:+.2f}%)")
    print(f"[{borrower_id}] revenue_trend={revenue['value']} ({revenue['magnitude_pct']:+.2f}%)")
    print(f"[{borrower_id}] declared_vs_actual_gap={gap['gap_pct']:.2f}%")
    print(f"[{borrower_id}] cash_flow_volatility={volatility['value']} (CoV={volatility['coefficient_of_variation']:.3f})")

    if borrower_id == "b_contradiction":
        assert income["value"] in ("stable", "rising"), "b_contradiction must show non-declining bank income"
        assert revenue["value"] == "declining", "b_contradiction must show declining GST revenue"
    if borrower_id == "b_clean":
        assert revenue["value"] != "declining", "b_clean must not trigger the income-vs-revenue rule"
        assert gap["gap_pct"] <= 15.0, "b_clean must not trigger the declared-vs-actual rule"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for borrower_id, builder in ALL_BORROWERS.items():
        data = builder()
        _self_check(borrower_id, data)
        out_path = OUTPUT_DIR / f"{borrower_id}.json"
        out_path.write_text(json.dumps(data, indent=2))
        print(f"[{borrower_id}] wrote {out_path}\n")


if __name__ == "__main__":
    main()
