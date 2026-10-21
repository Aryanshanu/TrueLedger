import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

output_dir = os.path.join("frontend", "public", "data", "samples")
os.makedirs(output_dir, exist_ok=True)

entities = [
    {
        "id": "kaveri",
        "name": "Annapurna Agro Commodities Pvt Ltd",
        "sector": "Agriculture & Commodities",
        "turnover": 452000000,
        "bank_inflows": 468000000,
        "net_profit": 32000000,
        "pan": "AABCK4812G",
        "gstin": "36AABCK4812G1Z2",
        "loan": 85000000,
        "trend_bank": "+3.5%",
        "trend_gst": "+3.1%",
        "variance": "0.4%",
        "verdict": "APPROVE",
        "score": 0.88,
        "confidence": 0.88,
        "multiplier": 1.0,
        "color": "10b981",
        "narrative": "Consistent alignment between Account Aggregator bank deposits (INR 46.8 Cr) and GSTR-3B filings (INR 45.2 Cr). APMC mandi electronic receipt reconciliation validates genuine farmgate grain trade volume without divergence."
    },
    {
        "id": "deccan",
        "name": "Trisara Cements & Infrastructure Pvt Ltd",
        "sector": "Cement & Building Materials",
        "turnover": 785000000,
        "bank_inflows": 760000000,
        "net_profit": 64000000,
        "pan": "AADCD7891K",
        "gstin": "37AADCD7891K1Z9",
        "loan": 140000000,
        "trend_bank": "-2.1%",
        "trend_gst": "-2.4%",
        "variance": "0.3%",
        "verdict": "APPROVE",
        "score": 0.82,
        "confidence": 0.82,
        "multiplier": 1.0,
        "color": "10b981",
        "narrative": "Verified rail-freight e-way bill volume matches GSTR-1 inter-state dispatches. Clinker procurement and plant power consumption correlate precisely with filed turnover."
    },
    {
        "id": "kalyani",
        "name": "Virelion Specialty Metals Pvt Ltd",
        "sector": "Steel & Heavy Metallurgy",
        "turnover": 380000000,
        "bank_inflows": 520000000,
        "net_profit": 18000000,
        "pan": "AABCK9921E",
        "gstin": "27AABCK9921E1Z3",
        "loan": 95000000,
        "trend_bank": "+5.4%",
        "trend_gst": "-21.8%",
        "variance": "27.2%",
        "verdict": "MANUAL REVIEW",
        "score": 0.14,
        "confidence": 0.50,
        "multiplier": 0.29,
        "color": "f59e0b",
        "narrative": "Flagged RULE_INCOME_REV_DIVERGENCE: Commercial bank deposits indicate INR 52.0 Cr inflows while GSTR-3B tax declarations contract to INR 38.0 Cr. Potential circular routing or unreported scrap liquidation."
    },
    {
        "id": "bharat",
        "name": "Aravind Capital & Trade Finance Pvt Ltd",
        "sector": "Financial Services & NBFC",
        "turnover": 125000000,
        "bank_inflows": 128000000,
        "net_profit": 28000000,
        "pan": "AABCB6619M",
        "gstin": "27AABCB6619M1Z1",
        "loan": 60000000,
        "trend_bank": "+1.2%",
        "trend_gst": "+0.8%",
        "variance": "0.4%",
        "verdict": "APPROVE",
        "score": 0.85,
        "confidence": 0.85,
        "multiplier": 1.0,
        "color": "10b981",
        "narrative": "Loan origination fee collection and structured interest cashflow reconcile across AA bank feeds and GSTR-9 annual summary. Liquidity coverage ratio (LCR) exceeds regulatory hurdle."
    },
    {
        "id": "zenith",
        "name": "Nexvara Chemicals & Agrochemicals Pvt Ltd",
        "sector": "Chemicals & Allied Products",
        "turnover": 210000000,
        "bank_inflows": 295000000,
        "net_profit": 11000000,
        "pan": "AACZ7712Q",
        "gstin": "24AACZ7712Q1Z4",
        "loan": 75000000,
        "trend_bank": "+7.8%",
        "trend_gst": "-18.2%",
        "variance": "26.0%",
        "verdict": "MANUAL REVIEW",
        "score": 0.15,
        "confidence": 0.50,
        "multiplier": 0.31,
        "color": "f59e0b",
        "narrative": "Critical variance detected between inward e-way bill raw chemical purchases and reported GSTR-3B sales. Primary current account shows unmapped round-tripping transactions."
    }
]

header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
border_thin = Border(
    left=Side(style='thin', color='E2E8F0'),
    right=Side(style='thin', color='E2E8F0'),
    top=Side(style='thin', color='E2E8F0'),
    bottom=Side(style='thin', color='E2E8F0')
)

for ent in entities:
    # 1. GSTR Excel
    wb_gst = openpyxl.Workbook()
    ws_gst = wb_gst.active
    ws_gst.title = "GSTR-3B & 1 Reconciliation"
    ws_gst.append(["Period", "Return Type", "Taxable Turnover (INR)", "IGST (INR)", "CGST (INR)", "SGST (INR)", "Filing Status", "ARN Reference"])
    
    monthly_gst = ent["turnover"] / 12
    months = ["Apr-25", "May-25", "Jun-25", "Jul-25", "Aug-25", "Sep-25", "Oct-25", "Nov-25", "Dec-25", "Jan-26", "Feb-26", "Mar-26"]
    for idx, m in enumerate(months):
        turnover = monthly_gst * (0.95 + (idx % 4) * 0.03)
        ws_gst.append([
            m,
            "GSTR-3B",
            round(turnover, 2),
            round(turnover * 0.10, 2),
            round(turnover * 0.04, 2),
            round(turnover * 0.04, 2),
            "Filed & Reconciled",
            f"AA{ent['pan'][:5]}{idx+10}2026"
        ])
    
    for cell in ws_gst[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    for row in ws_gst.iter_rows(min_row=2, max_col=8):
        for cell in row:
            cell.border = border_thin
            if cell.column in [3, 4, 5, 6]:
                cell.number_format = '#,##0.00'
    
    gst_path = os.path.join(output_dir, f"{ent['id']}_gstr_returns.xlsx")
    wb_gst.save(gst_path)

    # 2. ITR Excel
    wb_itr = openpyxl.Workbook()
    ws_itr = wb_itr.active
    ws_itr.title = "ITR Verification Ledger"
    ws_itr.append(["Assessment Year", "Form Type", "Gross Income (INR)", "Taxable Profit (INR)", "Depreciation (INR)", "Tax Paid (INR)", "Verification Status", "E-Filing Ack No"])
    
    ay_list = ["AY 2024-25", "AY 2025-26", "AY 2026-27"]
    for idx, ay in enumerate(ay_list):
        profit = ent["net_profit"] * (0.90 + idx * 0.12)
        gross = ent["turnover"] * (0.88 + idx * 0.10)
        ws_itr.append([
            ay,
            "ITR-6 (Corporate)",
            round(gross, 2),
            round(profit, 2),
            round(profit * 0.18, 2),
            round(profit * 0.25, 2),
            "E-Verified (CBDT API)",
            f"98421098{idx}2026"
        ])
    
    for cell in ws_itr[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    for row in ws_itr.iter_rows(min_row=2, max_col=8):
        for cell in row:
            cell.border = border_thin
            if cell.column in [3, 4, 5, 6]:
                cell.number_format = '#,##0.00'
    
    itr_path = os.path.join(output_dir, f"{ent['id']}_itr_filings.xlsx")
    wb_itr.save(itr_path)

    # 3. Bank Statement Excel
    wb_bank = openpyxl.Workbook()
    ws_bank = wb_bank.active
    ws_bank.title = "Commercial Account Statement"
    ws_bank.append(["Month", "Bank & Branch", "Total Credits (INR)", "Total Debits (INR)", "Avg Daily Balance (INR)", "Inward Mandate Txns", "Cheque Bounces", "AA Verification"])
    
    monthly_bank = ent["bank_inflows"] / 12
    for idx, m in enumerate(months):
        inflow = monthly_bank * (0.96 + (idx % 3) * 0.04)
        outflow = inflow * 0.91
        ws_bank.append([
            m,
            "HDFC Bank / Corporate Hub",
            round(inflow, 2),
            round(outflow, 2),
            round(inflow * 0.14, 2),
            round(68 + (idx * 5)),
            0 if ent["verdict"] == "APPROVE" else (1 if idx % 4 == 0 else 0),
            "Verified via Setu/Sahamati AA"
        ])
    
    for cell in ws_bank[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    for row in ws_bank.iter_rows(min_row=2, max_col=8):
        for cell in row:
            cell.border = border_thin
            if cell.column in [3, 4, 5]:
                cell.number_format = '#,##0.00'
    
    bank_path = os.path.join(output_dir, f"{ent['id']}_bank_statement.xlsx")
    wb_bank.save(bank_path)

print("Created all 15 Excel spreadsheets successfully in", output_dir)
