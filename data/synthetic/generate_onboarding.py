"""Generate a realistic 5-sheet onboarding Excel workbook.

Run with:  python -m data.synthetic.generate_onboarding
Output:    generated/financial_onboarding_test_data.xlsx

Sheet layout mirrors the real-world financial onboarding schema for Indian
businesses. Client_ID is the foreign key linking all five sheets. Every
numeric value uses Indian Rupee scale (lakhs / crores) and every status
uses the controlled vocabulary the frontend badge system expects
(Filed, Pending, Settled, Draft, Overdue).
"""

from __future__ import annotations

import os
import random
from datetime import date, timedelta
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Seed data — 5 representative Indian business profiles
# ---------------------------------------------------------------------------

CLIENTS = [
    {
        "client_id": "CLT001",
        "full_name": "Priya Sharma",
        "entity_type": "Individual",
        "pan": "AACPS1234F",
        "gstin": "27AACPS1234F1ZA",
        "primary_source": "DEPOSIT",
        "email": "priya.sharma@psconsulting.in",
        "phone": "+91-9812345670",
        "kyb_status": "Verified",
        "city": "Mumbai",
    },
    {
        "client_id": "CLT002",
        "full_name": "Sunshine Traders Pvt Ltd",
        "entity_type": "Private Limited",
        "pan": "AABCS9876E",
        "gstin": "09AABCS9876E1ZR",
        "primary_source": "CURRENT_ACCOUNT",
        "email": "accounts@sunshinetraders.co.in",
        "phone": "+91-9876543210",
        "kyb_status": "Pending",
        "city": "Delhi",
    },
    {
        "client_id": "CLT003",
        "full_name": "Digital Services LLP",
        "entity_type": "LLP",
        "pan": "AAGFD2345B",
        "gstin": "29AAGFD2345B1ZQ",
        "primary_source": "DEPOSIT",
        "email": "finance@digitalservicesllp.com",
        "phone": "+91-9901234567",
        "kyb_status": "Verified",
        "city": "Bengaluru",
    },
    {
        "client_id": "CLT004",
        "full_name": "Ramesh & Sons Enterprises",
        "entity_type": "Partnership",
        "pan": "AAHFR6789C",
        "gstin": "33AAHFR6789C1ZG",
        "primary_source": "OD_ACCOUNT",
        "email": "ramesh.sons@gmail.com",
        "phone": "+91-9443210987",
        "kyb_status": "Under Review",
        "city": "Chennai",
    },
    {
        "client_id": "CLT005",
        "full_name": "Varaha Agro Foods Pvt Ltd",
        "entity_type": "Public Limited",
        "pan": "AADCK4321D",
        "gstin": "36AADCK4321D1ZT",
        "primary_source": "CURRENT_ACCOUNT",
        "email": "cfo@varahaagro.com",
        "phone": "+91-9700123456",
        "kyb_status": "Verified",
        "city": "Hyderabad",
    },
]

# Realistic invoice counterparties
COUNTERPARTIES = [
    ("Infosys Ltd", "29AABCI1682H1ZB"),
    ("TCS Ltd", "27AAACT2727Q1ZM"),
    ("HDFC Bank Ltd", "27AAACH2702H1ZC"),
    ("Reliance Industries", "27AACCR4849R1Z9"),
    ("Wipro Ltd", "29AABCW0050A1ZP"),
    ("Bajaj Finance", "27AAACB2894F1Z4"),
    ("ICICI Bank", "27AAACI2859G1ZW"),
    ("L&T Finance", "27AAACU6390Q1Z5"),
]

FUND_NAMES = [
    ("HDFC Mid Cap Opportunities Fund", "Equity", "HDFC AMC"),
    ("Axis Long Term Equity Fund", "ELSS", "Axis AMC"),
    ("Mirae Asset Large Cap Fund", "Equity", "Mirae Asset"),
    ("SBI Liquid Fund", "Liquid", "SBI Funds"),
    ("ICICI Prudential Balanced Advantage", "Hybrid", "ICICI Pru AMC"),
    ("Parag Parikh Flexi Cap Fund", "Equity", "PPFAS AMC"),
    ("Kotak Gilt Fund", "Debt", "Kotak AMC"),
    ("DSP Tax Saver Fund", "ELSS", "DSP AMC"),
]

EXPENSE_CATEGORIES = [
    ("Office Rent", False),
    ("Software Subscriptions", True),
    ("Professional Services", True),
    ("Logistics & Courier", True),
    ("Marketing & Advertising", True),
    ("Employee Training", False),
    ("Office Supplies", True),
    ("Travel & Accommodation", False),
    ("Cloud Infrastructure", True),
    ("Legal & Compliance", False),
]

VENDOR_MAP = {
    "Office Rent": ("Prime Properties Pvt Ltd", "27AABCP1234A1ZK"),
    "Software Subscriptions": ("AWS India Pvt Ltd", "27AABCA1897B1ZQ"),
    "Professional Services": ("Deloitte India LLP", "27AABCD2894F1ZH"),
    "Logistics & Courier": ("Blue Dart Express Ltd", "27AABCB2893F1ZL"),
    "Marketing & Advertising": ("WPP India Pvt Ltd", "27AABCW0051B1ZO"),
    "Employee Training": ("NASSCOM Foundation", "07AAACN2468A1ZT"),
    "Office Supplies": ("Staples India Pvt Ltd", "27AABCS9877F1ZR"),
    "Travel & Accommodation": ("MakeMyTrip India Ltd", "07AABCM1234A1ZV"),
    "Cloud Infrastructure": ("Google India Pvt Ltd", "29AABCG2340A1ZW"),
    "Legal & Compliance": ("Khaitan & Co LLP", "27AABCK2348F1ZM"),
}

GST_STATUSES = ["Filed", "Filed", "Filed", "Pending", "Draft"]


def _random_date(start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, delta))


def _fmt_inr(amount: float) -> float:
    return round(amount, 2)


# ---------------------------------------------------------------------------
# Sheet generators
# ---------------------------------------------------------------------------

def gen_clients() -> list[dict]:
    return CLIENTS


def gen_invoices() -> list[dict]:
    rows = []
    inv_id = 1
    for client in CLIENTS:
        num_invoices = random.randint(4, 9)
        for _ in range(num_invoices):
            counterparty_name, counterparty_gstin = random.choice(COUNTERPARTIES)
            gross = _fmt_inr(random.uniform(50_000, 15_00_000))
            gst_rate = random.choice([0.05, 0.12, 0.18])
            gst_amt = _fmt_inr(gross * gst_rate)
            tds_rate = random.choice([0.01, 0.02, 0.10])
            tds_amt = _fmt_inr(gross * tds_rate)
            inv_date = _random_date(date(2025, 4, 1), date(2026, 3, 31))
            rows.append({
                "Invoice_ID": f"INV{inv_id:04d}",
                "Client_ID": client["client_id"],
                "Invoice_Date": inv_date.isoformat(),
                "Counterparty_Name": counterparty_name,
                "Counterparty_GSTIN": counterparty_gstin,
                "Gross_Amount_INR": gross,
                "GST_Amount_INR": gst_amt,
                "TDS_Amount_INR": tds_amt,
                "Net_Receivable_INR": _fmt_inr(gross + gst_amt - tds_amt),
                "Status": random.choice(["Settled", "Settled", "Pending", "Overdue"]),
            })
            inv_id += 1
    return rows


def gen_gst_filings() -> list[dict]:
    rows = []
    filing_id = 1
    periods = ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08",
               "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
               "2026-02", "2026-03"]
    for client in CLIENTS:
        for period in periods:
            turnover = _fmt_inr(random.uniform(2_00_000, 40_00_000))
            gst_payable = _fmt_inr(turnover * random.uniform(0.05, 0.18))
            itc = _fmt_inr(gst_payable * random.uniform(0.4, 0.9))
            net = _fmt_inr(gst_payable - itc)
            gstr1_status = random.choice(GST_STATUSES)
            gstr3b_status = "Filed" if gstr1_status == "Filed" else random.choice(["Filed", "Pending", "Draft"])
            rows.append({
                "Filing_ID": f"GST{filing_id:04d}",
                "Client_ID": client["client_id"],
                "Period": period,
                "Turnover_INR": turnover,
                "GSTR1_Status": gstr1_status,
                "GSTR3B_Status": gstr3b_status,
                "Output_Tax_INR": gst_payable,
                "ITC_Claimed_INR": itc,
                "Net_Payable_INR": net,
                "Filing_Date": _random_date(
                    date(int(period.split("-")[0]), int(period.split("-")[1]), 1),
                    date(int(period.split("-")[0]), int(period.split("-")[1]), 28),
                ).isoformat() if gstr1_status == "Filed" else "",
            })
            filing_id += 1
    return rows


def gen_mutual_funds() -> list[dict]:
    rows = []
    folio_id = 1
    for client in CLIENTS:
        num_folios = random.randint(2, 5)
        selected_funds = random.sample(FUND_NAMES, num_folios)
        for fund_name, fund_type, amc in selected_funds:
            nav = _fmt_inr(random.uniform(18.5, 450.0))
            units = _fmt_inr(random.uniform(100, 5000))
            sip_amount = _fmt_inr(random.choice([5000, 10000, 15000, 25000, 50000]))
            lumpsum = _fmt_inr(random.uniform(0, 5_00_000))
            current_value = _fmt_inr(nav * units)
            rows.append({
                "Folio_ID": f"FOL{folio_id:05d}",
                "Client_ID": client["client_id"],
                "Fund_Name": fund_name,
                "Fund_Type": fund_type,
                "AMC": amc,
                "SIP_Amount_INR": sip_amount,
                "SIP_Frequency": "Monthly",
                "Lumpsum_INR": lumpsum,
                "NAV": nav,
                "Units_Held": units,
                "Current_Value_INR": current_value,
                "XIRR_Pct": _fmt_inr(random.uniform(8.5, 22.0)),
            })
            folio_id += 1
    return rows


def gen_expenses() -> list[dict]:
    rows = []
    exp_id = 1
    for client in CLIENTS:
        num_expenses = random.randint(6, 14)
        for _ in range(num_expenses):
            category, itc_eligible = random.choice(EXPENSE_CATEGORIES)
            vendor_name, vendor_gstin = VENDOR_MAP[category]
            amount = _fmt_inr(random.uniform(5_000, 8_00_000))
            gst_rate = random.choice([0.05, 0.12, 0.18])
            gst_amt = _fmt_inr(amount * gst_rate)
            itc_amt = gst_amt if itc_eligible else 0.0
            rows.append({
                "Expense_ID": f"EXP{exp_id:04d}",
                "Client_ID": client["client_id"],
                "Expense_Date": _random_date(date(2025, 4, 1), date(2026, 3, 31)).isoformat(),
                "Category": category,
                "Vendor_Name": vendor_name,
                "Vendor_GSTIN": vendor_gstin,
                "Amount_INR": amount,
                "GST_Paid_INR": gst_amt,
                "ITC_Eligible": "Yes" if itc_eligible else "No",
                "ITC_Amount_INR": itc_amt,
                "Status": random.choice(["Settled", "Settled", "Pending", "Draft"]),
            })
            exp_id += 1
    return rows


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
        ws.append([row.get(h, "") for h in headers])
        if i % 2 == 0:
            for cell in ws[i]:
                cell.fill = ALT_FILL

    # Auto-size columns (capped at 36)
    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[get_column_letter(col[0].column)].width = min(max_len + 3, 36)


def build_workbook(output_path: str) -> None:
    random.seed(42)  # reproducible
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # remove default blank sheet

    sheets = [
        (
            "1_Client_Onboarding",
            ["Client_ID", "Full_Name", "Entity_Type", "PAN", "GSTIN",
             "Primary_Source", "Email", "Phone", "KYB_Status", "City"],
            gen_clients(),
        ),
        (
            "2_Income_Invoices",
            ["Invoice_ID", "Client_ID", "Invoice_Date", "Counterparty_Name",
             "Counterparty_GSTIN", "Gross_Amount_INR", "GST_Amount_INR",
             "TDS_Amount_INR", "Net_Receivable_INR", "Status"],
            gen_invoices(),
        ),
        (
            "3_GST_Filings",
            ["Filing_ID", "Client_ID", "Period", "Turnover_INR",
             "GSTR1_Status", "GSTR3B_Status", "Output_Tax_INR",
             "ITC_Claimed_INR", "Net_Payable_INR", "Filing_Date"],
            gen_gst_filings(),
        ),
        (
            "4_Mutual_Funds",
            ["Folio_ID", "Client_ID", "Fund_Name", "Fund_Type", "AMC",
             "SIP_Amount_INR", "SIP_Frequency", "Lumpsum_INR", "NAV",
             "Units_Held", "Current_Value_INR", "XIRR_Pct"],
            gen_mutual_funds(),
        ),
        (
            "5_Business_Expenses",
            ["Expense_ID", "Client_ID", "Expense_Date", "Category",
             "Vendor_Name", "Vendor_GSTIN", "Amount_INR", "GST_Paid_INR",
             "ITC_Eligible", "ITC_Amount_INR", "Status"],
            gen_expenses(),
        ),
    ]

    for sheet_name, headers, rows in sheets:
        ws = wb.create_sheet(title=sheet_name)
        _write_sheet(ws, headers, rows)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)
    print(f"Generated: {output_path}")
    for sheet_name, _, rows in sheets:
        print(f"  {sheet_name}: {len(rows)} rows")


if __name__ == "__main__":
    build_workbook("generated/financial_onboarding_test_data.xlsx")
