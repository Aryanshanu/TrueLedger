"""POST /borrowers/upload - the FastAPI boundary only (validation, the
xlsx/csv/xls routing added on top of extraction, Firestore writes). The
extraction/assembly logic itself is covered in tests/test_extraction.py;
here `extract_source` is mocked so these tests need no live Gemini call."""

from __future__ import annotations

import asyncio
import io
import time
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


def _minimal_valid_source(doc_type: str) -> dict:
    """A non-empty stand-in for each required source, so tests that aren't
    specifically exercising the "empty required source" validation (see
    test_empty_required_source_rejected_with_a_clear_422 below) don't trip
    it incidentally."""
    base = {"fi_type": doc_type, "profile": {}, "summary": {}, "transactions": [], "returns": []}
    if doc_type == "DEPOSIT":
        base["transactions"] = [{"txn_id": "up_txn_001", "date": "2026-01-05", "amount": 1000.0, "type": "CREDIT"}]
    elif doc_type == "GSTR1_3B":
        base["returns"] = [{"period": "2026-01", "declared_turnover": 1000.0, "filed_on_time": True}]
    return base


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
        return _minimal_valid_source(doc_type)

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
        return _minimal_valid_source(doc_type)

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


def test_document_extraction_runs_concurrently_not_sequentially():
    """The regression this guards: extract_source used to be called
    synchronously in a for-loop, so N uploaded documents took N times one
    document's latency. With real concurrency, 4 documents each "taking"
    120ms should finish in ~120ms total, not ~480ms."""
    DELAY = 0.12

    async def slow_fake_extract_source(doc_type, file_bytes, mime_type):
        await asyncio.sleep(DELAY)
        return _minimal_valid_source(doc_type)

    p1, p2, p3 = _client_with_mocks(slow_fake_extract_source)
    with p1, p2, p3:
        client = TestClient(app)
        start = time.monotonic()
        resp = client.post(
            "/borrowers/upload",
            data={"loan_amount_requested": "100000"},
            files={
                "bank_statement": ("b.pdf", b"x", "application/pdf"),
                "gst_return": ("g.pdf", b"x", "application/pdf"),
                "mutual_fund_statement": ("m.pdf", b"x", "application/pdf"),
                "insurance_policy": ("i.pdf", b"x", "application/pdf"),
            },
        )
        elapsed = time.monotonic() - start

    assert resp.status_code == 200
    # Sequential would take ~4 * DELAY = 0.48s; concurrent should land near
    # one DELAY plus overhead. The cutoff is deliberately generous (2x one
    # delay) to stay robust on a loaded CI runner while still failing hard
    # if the four calls were serialized.
    assert elapsed < DELAY * 2, f"expected concurrent extraction (~{DELAY}s), took {elapsed:.3f}s - looks sequential"


def test_empty_optional_file_is_treated_as_not_provided():
    """A browser can submit an optional file input as a zero-byte, empty-
    filename part rather than omitting the field outright (observed in the
    wild - see the "Skip empty optional uploads" fix this guards). That
    must be treated the same as not uploading it at all - a 422, not a
    silent crash - while required sources still enforce their own checks."""
    seen = {}

    def fake_extract_source(doc_type, file_bytes, mime_type):
        seen[doc_type] = True
        return _minimal_valid_source(doc_type)

    p1, p2, p3 = _client_with_mocks(fake_extract_source)
    with p1, p2, p3:
        client = TestClient(app)
        resp = client.post(
            "/borrowers/upload",
            data={"loan_amount_requested": "100000"},
            files={
                "bank_statement": ("b.pdf", b"x", "application/pdf"),
                "gst_return": ("g.pdf", b"x", "application/pdf"),
                "mutual_fund_statement": ("", b"", "application/octet-stream"),
            },
        )
    assert resp.status_code == 200
    assert "MUTUAL_FUNDS" not in seen  # never sent to extraction at all


def test_empty_required_source_rejected_with_a_clear_422():
    """The exact failure mode a real upload hit: GST extraction legitimately
    succeeded but found zero filing periods (e.g. the wrong document, or a
    page the model couldn't read) - the agent's own instructions say "no
    evidence, no claim", so the pipeline would otherwise proceed as if GST
    had simply agreed with everything, never having examined it. Must be
    rejected here instead, before any Firestore write or pipeline run."""

    def fake_extract_source(doc_type, file_bytes, mime_type):
        if doc_type == "GSTR1_3B":
            return _minimal_valid_source("GSTR1_3B") | {"returns": []}
        return _minimal_valid_source(doc_type)

    p1, p2, p3 = _client_with_mocks(fake_extract_source)
    with p1, p2, p3:
        client = TestClient(app)
        resp = client.post(
            "/borrowers/upload",
            data={"loan_amount_requested": "100000"},
            files={
                "bank_statement": ("b.pdf", b"x", "application/pdf"),
                "gst_return": ("not_actually_a_gst_return.pdf", b"x", "application/pdf"),
            },
        )
    assert resp.status_code == 422
    assert "GST return" in resp.json()["detail"]


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
