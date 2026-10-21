"""Generate enterprise_finance_live_state.xlsx + enterprise_live_state.json.

Represents Varaha Agro Foods Pvt Ltd (CLT005) — the primary entity for the
TrueLedger Dashboard workspace. Run with:

    python -m data.synthetic.generate_enterprise_live

Outputs:
  generated/enterprise_finance_live_state.xlsx  (for inspection / download)
  frontend/public/enterprise_live_state.json    (served as static asset)
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Entity master
# ---------------------------------------------------------------------------

ENTITY = {
    "name": "Varaha Agro Foods Pvt Ltd",
    "pan": "AADCK4321D",
    "gstin": "36AADCK4321D1ZT",
    "state": "Telangana",
    "state_code": "36",
    "entity_type": "Public Limited",
    "industry": "Agricultural Food Processing",
    "city": "Hyderabad",
    "as_of": "2026-10-10",
    "fy": "FY2026-27",
    "banker": "SBI, Hyderabad Main Branch",
    "ca_firm": "K. Srinivas & Associates",
}

# ---------------------------------------------------------------------------
# Dashboard Summary KPIs (Q2 FY2026: Jul–Sep 2026)
# ---------------------------------------------------------------------------

SUMMARY = {
    "realized_revenue": {
        "value": 45823000,
        "delta_pct": 8.4,
        "delta_direction": "up",
        "period": "Q2 FY2026",
        "label": "Realized Revenue",
        "note": "Jul–Sep 2026 consolidated",
    },
    "net_gst_payable": {
        "value": 3847200,
        "delta_pct": -2.1,
        "delta_direction": "down",
        "period": "Sep 2026",
        "label": "Net GST Payable",
        "note": "After ITC offset, Sep 2026",
    },
    "pending_tds": {
        "value": 892500,
        "delta_pct": 12.3,
        "delta_direction": "up",
        "period": "Q2 FY2026",
        "label": "Pending TDS Receivable",
        "note": "Form 26AS unmatched entries",
    },
    "mf_aum": {
        "value": 28450000,
        "delta_pct": 4.7,
        "delta_direction": "up",
        "period": "Oct 10, 2026",
        "label": "Liquid MF AUM",
        "note": "Pledgeable asset buffer",
    },
}

# ---------------------------------------------------------------------------
# GST Compliance Tracker (12 months: Oct 2025 – Sep 2026)
# ---------------------------------------------------------------------------

COMPLIANCE = [
    {"period": "Sep 2026", "gstr1_status": "Pending",        "gstr3b_status": "Pending",
     "itc_eligible_inr": 0,       "net_payable_inr": 0,       "action_required": False,
     "action_note": "Due Oct 20, 2026"},
    {"period": "Aug 2026", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 921000,   "net_payable_inr": 389000,  "action_required": False,
     "action_note": ""},
    {"period": "Jul 2026", "gstr1_status": "Filed",          "gstr3b_status": "Draft",
     "itc_eligible_inr": 0,        "net_payable_inr": 512000,  "action_required": True,
     "action_note": "GSTR-3B pending — ITC offset blocked"},
    {"period": "Jun 2026", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 380000,   "net_payable_inr": 140000,  "action_required": False,
     "action_note": ""},
    {"period": "May 2026", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 270000,   "net_payable_inr": 160000,  "action_required": False,
     "action_note": ""},
    {"period": "Apr 2026", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 310000,   "net_payable_inr": 220000,  "action_required": False,
     "action_note": ""},
    {"period": "Mar 2026", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 520000,   "net_payable_inr": 80000,   "action_required": False,
     "action_note": ""},
    {"period": "Feb 2026", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 280000,   "net_payable_inr": 240000,  "action_required": False,
     "action_note": ""},
    {"period": "Jan 2026", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 350000,   "net_payable_inr": 190000,  "action_required": False,
     "action_note": ""},
    {"period": "Dec 2025", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 410000,   "net_payable_inr": 120000,  "action_required": False,
     "action_note": ""},
    {"period": "Nov 2025", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 290000,   "net_payable_inr": 210000,  "action_required": False,
     "action_note": ""},
    {"period": "Oct 2025", "gstr1_status": "Filed",          "gstr3b_status": "Filed",
     "itc_eligible_inr": 320000,   "net_payable_inr": 180000,  "action_required": False,
     "action_note": ""},
]

# ---------------------------------------------------------------------------
# Smart Decision Actions
# ---------------------------------------------------------------------------

ACTIONS = [
    {
        "id": "file_gstr3b_jul26",
        "priority": "high",
        "label": "File GSTR-3B for Jul 2026",
        "detail": "GSTR-1 filed but GSTR-3B in Draft. ₹5.12L payable blocked. ITC offset of ₹0 until filed.",
        "period": "Jul 2026",
        "badge": "Action Required",
    },
    {
        "id": "reconcile_gstr2b_aug26",
        "priority": "medium",
        "label": "Reconcile GSTR-2B ITC Offset",
        "detail": "₹9.21L ITC claimed in Aug 2026. Match against vendor GSTR-1 portal entries before GSTR-2B auto-population locks.",
        "period": "Aug 2026",
        "badge": "Pending Review",
    },
    {
        "id": "tds_sync_q2",
        "priority": "medium",
        "label": "Trigger Form 26AS TDS Sync",
        "detail": "₹8.93L TDS receivable for Q2 FY2026 unmatched. Initiate AIS reconciliation with TRACES portal.",
        "period": "Q2 FY2026",
        "badge": "Pending Review",
    },
    {
        "id": "file_gstr1_sep26",
        "priority": "low",
        "label": "File GSTR-1 for Sep 2026",
        "detail": "Due Oct 11, 2026. 7B2C entries from Sep totalling approx. ₹1.2Cr to declare.",
        "period": "Sep 2026",
        "badge": "Due Soon",
    },
]

# ---------------------------------------------------------------------------
# Invoice Pipeline (last 30 days — Sep 10 to Oct 10, 2026)
# Valid GSTIN: ^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$
# ---------------------------------------------------------------------------

INVOICES = [
    {"id": "INV2601", "date": "2026-10-08", "buyer": "Reliance Retail Ltd",
     "buyer_gstin": "27AACCR4849R1Z9", "amount_inr": 1850000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Pending",    "gstin_valid": True},
    {"id": "INV2602", "date": "2026-10-05", "buyer": "ITC Ltd",
     "buyer_gstin": "19AABCI5209G1ZQ", "amount_inr": 2340000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Pending",    "gstin_valid": True},
    {"id": "INV2603", "date": "2026-10-01", "buyer": "Haldirams Foods Pvt Ltd",
     "buyer_gstin": "INVALID-GSTIN-001", "amount_inr": 970000,  "gst_rate": 0.12,
     "tds_rate": 0.02, "status": "Pending",    "gstin_valid": False,
     "validation_error": "GSTIN format invalid — expected 15-char GST registration number"},
    {"id": "INV2604", "date": "2026-09-28", "buyer": "Britannia Industries",
     "buyer_gstin": "29AABCB5012F1ZB", "amount_inr": 1560000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Settled",    "gstin_valid": True},
    {"id": "INV2605", "date": "2026-09-25", "buyer": "Mother Dairy Fruit & Veg",
     "buyer_gstin": "07AABCM0423B1ZP", "amount_inr": 3120000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Settled",    "gstin_valid": True},
    {"id": "INV2606", "date": "2026-09-22", "buyer": "Parle Agro Pvt Ltd",
     "buyer_gstin": "27AABCP7201H1Z0", "amount_inr": 780000,  "gst_rate": 0.12,
     "tds_rate": 0.02, "status": "Settled",    "gstin_valid": True},
    {"id": "INV2607", "date": "2026-09-18", "buyer": "Sunfeast (ITC Foods)",
     "buyer_gstin": "29AABCI5209G1ZQ", "amount_inr": 1230000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Settled",    "gstin_valid": True},
    {"id": "INV2608", "date": "2026-09-15", "buyer": "Amul Dairy (GCMMF)",
     "buyer_gstin": "24AABCG0291B1ZI", "amount_inr": 4500000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Settled",    "gstin_valid": True},
    {"id": "INV2609", "date": "2026-09-12", "buyer": "Desai Agro (invalid entry)",
     "buyer_gstin": "36XYZABC1234",    "amount_inr": 420000,  "gst_rate": 0.18,
     "tds_rate": 0.10, "status": "Overdue",    "gstin_valid": False,
     "validation_error": "GSTIN too short — must be exactly 15 characters"},
    {"id": "INV2610", "date": "2026-09-10", "buyer": "Cargill India Pvt Ltd",
     "buyer_gstin": "27AABCC5011F1ZP", "amount_inr": 6800000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Overdue",    "gstin_valid": True},
    {"id": "INV2611", "date": "2026-09-08", "buyer": "Adani Agri Fresh Ltd",
     "buyer_gstin": "24AABCA6221G1ZD", "amount_inr": 2100000, "gst_rate": 0.05,
     "tds_rate": 0.01, "status": "Settled",    "gstin_valid": True},
    {"id": "INV2612", "date": "2026-09-05", "buyer": "Godrej Agrovet Ltd",
     "buyer_gstin": "27AABCG6128M1Z8", "amount_inr": 1890000, "gst_rate": 0.12,
     "tds_rate": 0.02, "status": "Settled",    "gstin_valid": True},
]

# ---------------------------------------------------------------------------
# TDS Tracker
# ---------------------------------------------------------------------------

TDS_RECORDS = [
    {"quarter": "Q2 FY2026", "period": "Jul–Sep 2026", "form": "26AS",
     "deductor": "Cargill India Pvt Ltd", "amount_inr": 68000,  "status": "Unmatched",
     "traces_ref": "TDS2620001"},
    {"quarter": "Q2 FY2026", "period": "Jul–Sep 2026", "form": "26AS",
     "deductor": "Amul Dairy (GCMMF)",    "amount_inr": 45000,  "status": "Unmatched",
     "traces_ref": "TDS2620002"},
    {"quarter": "Q2 FY2026", "period": "Jul–Sep 2026", "form": "26AS",
     "deductor": "ITC Ltd",               "amount_inr": 23400,  "status": "Unmatched",
     "traces_ref": "TDS2620003"},
    {"quarter": "Q1 FY2026", "period": "Apr–Jun 2026", "form": "26AS",
     "deductor": "Reliance Retail Ltd",   "amount_inr": 185000, "status": "Matched",
     "traces_ref": "TDS2610001"},
    {"quarter": "Q1 FY2026", "period": "Apr–Jun 2026", "form": "26AS",
     "deductor": "Britannia Industries",  "amount_inr": 15600,  "status": "Matched",
     "traces_ref": "TDS2610002"},
]

# ---------------------------------------------------------------------------
# MF Portfolio
# ---------------------------------------------------------------------------

MF_PORTFOLIO = [
    {"folio": "FOL00101", "fund": "SBI Liquid Fund",                  "type": "Liquid",
     "amc": "SBI Funds", "units": 8924.32, "nav": 1842.50,
     "current_value_inr": 16430000, "xirr_pct": 7.1},
    {"folio": "FOL00102", "fund": "HDFC Mid Cap Opportunities Fund",  "type": "Equity",
     "amc": "HDFC AMC", "units": 2341.00, "nav": 1827.80,
     "current_value_inr": 4279000,  "xirr_pct": 18.4},
    {"folio": "FOL00103", "fund": "Kotak Gilt Fund",                  "type": "Debt",
     "amc": "Kotak AMC", "units": 4512.50, "nav": 1280.30,
     "current_value_inr": 5778000,  "xirr_pct": 6.8},
    {"folio": "FOL00104", "fund": "Axis Long Term Equity Fund",       "type": "ELSS",
     "amc": "Axis AMC", "units": 876.00,  "nav": 223.80,
     "current_value_inr": 196000,   "xirr_pct": 14.2},
    {"folio": "FOL00105", "fund": "ICICI Pru Balanced Advantage",    "type": "Hybrid",
     "amc": "ICICI Pru AMC", "units": 1567.00, "nav": 1127.60,
     "current_value_inr": 1767000,  "xirr_pct": 11.6},
]


# ---------------------------------------------------------------------------
# Workbook builder
# ---------------------------------------------------------------------------

HEADER_FILL = PatternFill(start_color="1a2433", end_color="1a2433", fill_type="solid")
HEADER_FONT = Font(bold=True, color="c9a24d", size=10)
ALT_FILL = PatternFill(start_color="0f1520", end_color="0f1520", fill_type="solid")


def _write_sheet(ws, headers: list[str], rows: list[dict]) -> None:
    ws.append(headers)
    for cell in ws[1]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="left", vertical="center")
    for i, row in enumerate(rows, start=2):
        ws.append([row.get(h, row.get(h.lower(), "")) for h in headers])
        if i % 2 == 0:
            for cell in ws[i]:
                cell.fill = ALT_FILL
    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[get_column_letter(col[0].column)].width = min(max_len + 3, 40)


def build_workbook(output_path: str) -> None:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    # Sheet 1: Dashboard Summary
    ws1 = wb.create_sheet("Dashboard_Summary")
    sum_headers = ["Metric", "Value_INR", "Delta_Pct", "Delta_Direction", "Period", "Note"]
    sum_rows = [
        {"Metric": v["label"], "Value_INR": v["value"],
         "Delta_Pct": v["delta_pct"], "Delta_Direction": v["delta_direction"],
         "Period": v["period"], "Note": v["note"]}
        for v in SUMMARY.values()
    ]
    _write_sheet(ws1, sum_headers, sum_rows)

    # Sheet 2: GST Compliance
    ws2 = wb.create_sheet("GST_Compliance")
    gst_headers = ["Period", "GSTR1_Status", "GSTR3B_Status",
                   "ITC_Eligible_INR", "Net_Payable_INR", "Action_Required", "Action_Note"]
    _write_sheet(ws2, gst_headers, COMPLIANCE)

    # Sheet 3: Invoice Pipeline
    ws3 = wb.create_sheet("Invoice_Pipeline")
    inv_headers = ["Invoice_ID", "Date", "Buyer_Name", "Buyer_GSTIN",
                   "Amount_INR", "GST_Rate", "TDS_Rate", "Status",
                   "GSTIN_Valid", "Validation_Error"]
    inv_rows = [
        {
            "Invoice_ID": r["id"], "Date": r["date"],
            "Buyer_Name": r["buyer"], "Buyer_GSTIN": r["buyer_gstin"],
            "Amount_INR": r["amount_inr"], "GST_Rate": r["gst_rate"],
            "TDS_Rate": r["tds_rate"], "Status": r["status"],
            "GSTIN_Valid": str(r["gstin_valid"]),
            "Validation_Error": r.get("validation_error", ""),
        }
        for r in INVOICES
    ]
    _write_sheet(ws3, inv_headers, inv_rows)

    # Sheet 4: TDS Tracker
    ws4 = wb.create_sheet("TDS_Tracker")
    tds_headers = ["Quarter", "Period", "Form", "Deductor",
                   "Amount_INR", "Status", "TRACES_Ref"]
    _write_sheet(ws4, tds_headers, TDS_RECORDS)

    # Sheet 5: MF Portfolio
    ws5 = wb.create_sheet("MF_Portfolio")
    mf_headers = ["Folio_ID", "Fund_Name", "Fund_Type", "AMC",
                  "Units_Held", "NAV", "Current_Value_INR", "XIRR_Pct"]
    mf_rows = [
        {"Folio_ID": r["folio"], "Fund_Name": r["fund"], "Fund_Type": r["type"],
         "AMC": r["amc"], "Units_Held": r["units"], "NAV": r["nav"],
         "Current_Value_INR": r["current_value_inr"], "XIRR_Pct": r["xirr_pct"]}
        for r in MF_PORTFOLIO
    ]
    _write_sheet(ws5, mf_headers, mf_rows)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)
    print(f"Workbook: {output_path}")


def build_json(output_path: str) -> None:
    payload = {
        "entity": ENTITY,
        "summary": SUMMARY,
        "compliance": COMPLIANCE,
        "actions": ACTIONS,
        "invoices": INVOICES,
        "tds": TDS_RECORDS,
        "mf_portfolio": MF_PORTFOLIO,
    }
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"JSON:     {output_path}")


if __name__ == "__main__":
    build_workbook("generated/enterprise_finance_live_state.xlsx")
    build_json("frontend/public/enterprise_live_state.json")
    print("Done.")
