"""POST /borrowers/upload - the FastAPI boundary only (validation, the
xlsx/csv/xls routing added on top of extraction, Firestore writes). The
extraction/assembly logic itself is covered in tests/test_extraction.py;
here `extract_source` is mocked so these tests need no live Gemini call."""

from __future__ import annotations

import io
from unittest.mock import patch

import openpyxl
from fastapi.testclient import TestClient

from backend.main import app


def _xlsx_bytes(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _client_with_mocks(extract_source_mock):
    return patch("backend.main.extract_source", side_effect=extract_source_mock), patch(
        "backend.main.set_fi_data"
    ), patch("backend.main.set_consent")


def test_missing_required_field_returns_422():
    client = TestClient(app)
    resp = client.post(
        "/borrowers/upload",
        data={"loan_amount_requested": "100000"},
        files={"bank_statement": ("b.pdf", b"x", "application/pdf")},
    )
    assert resp.status_code == 422


def test_non_positive_loan_amount_returns_422():
    client = TestClient(app)
    resp = client.post(
        "/borrowers/upload",
        data={"loan_amount_requested": "0"},
        files={
            "bank_statement": ("b.pdf", b"x", "application/pdf"),
            "gst_return": ("g.pdf", b"x", "application/pdf"),
        },
    )
    assert resp.status_code == 422
    assert "loan_amount_requested" in resp.json()["detail"]


def test_xlsx_upload_is_flattened_to_text_before_extraction():
    seen = {}

    def fake_extract_source(doc_type, file_bytes, mime_type):
        seen[doc_type] = (file_bytes, mime_type)
        return {"fi_type": doc_type, "profile": {}, "summary": {}, "transactions": [], "returns": []}

    xlsx = _xlsx_bytes([["date", "amount", "type"], ["2026-01-05", 20000, "CREDIT"]])
    p1, p2, p3 = _client_with_mocks(fake_extract_source)
    with p1, p2, p3:
        client = TestClient(app)
        resp = client.post(
            "/borrowers/upload",
            data={"loan_amount_requested": "100000"},
            files={
                "bank_statement": (
                    "statement.xlsx",
                    xlsx,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ),
                "gst_return": ("g.pdf", b"x", "application/pdf"),
            },
        )
    assert resp.status_code == 200
    flattened_bytes, mime_type = seen["DEPOSIT"]
    flattened_text = flattened_bytes.decode("utf-8")
    assert mime_type == "text/plain"
    assert "# Sheet: Sheet1" in flattened_text
    assert "2026-01-05,20000,CREDIT" in flattened_text


def test_csv_upload_mime_normalized_to_text_plain():
    seen = {}

    def fake_extract_source(doc_type, file_bytes, mime_type):
        seen[doc_type] = (file_bytes, mime_type)
        return {"fi_type": doc_type, "profile": {}, "summary": {}, "transactions": [], "returns": []}

    csv_bytes = b"period,declared_turnover,filed_on_time\n2026-01,100000,true\n"
    p1, p2, p3 = _client_with_mocks(fake_extract_source)
    with p1, p2, p3:
        client = TestClient(app)
        resp = client.post(
            "/borrowers/upload",
            data={"loan_amount_requested": "100000"},
            files={
                "bank_statement": ("b.pdf", b"x", "application/pdf"),
                "gst_return": ("return.csv", csv_bytes, "text/csv"),
            },
        )
    assert resp.status_code == 200
    body, mime_type = seen["GSTR1_3B"]
    assert mime_type == "text/plain"
    assert body == csv_bytes  # CSV is passed through verbatim, only the mime type changes


def test_legacy_xls_is_rejected_with_a_clear_422():
    def fake_extract_source(doc_type, file_bytes, mime_type):
        raise AssertionError("extract_source must never be called for a rejected .xls upload")

    p1, p2, p3 = _client_with_mocks(fake_extract_source)
    with p1, p2, p3:
        client = TestClient(app)
        resp = client.post(
            "/borrowers/upload",
            data={"loan_amount_requested": "100000"},
            files={
                "bank_statement": ("statement.xls", b"\xd0\xcf\x11\xe0 not really an xls", "application/vnd.ms-excel"),
                "gst_return": ("g.pdf", b"x", "application/pdf"),
            },
        )
    assert resp.status_code == 422
    assert ".xls" in resp.json()["detail"]
