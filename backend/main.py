"""Cloud Run API service wrapping the agent pipeline.

Endpoints (per the build brief's API contract sketch):
    POST /borrowers/{id}/evaluate        -> triggers the pipeline, returns final decision
    GET  /borrowers/{id}/ledger          -> full ordered list of ledger steps for replay
    GET  /borrowers/{id}/consent-status  -> per-source days-remaining and confidence multiplier
    POST /borrowers/upload                -> extracts real uploaded documents into a new borrower_id
    GET  /health                         -> liveness check for Cloud Run
"""

from __future__ import annotations

import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from agents.consent import build_consent_status
from agents.extraction import assemble_fi_data, build_consent_block, extract_source
from agents.firestore_gateway import get_consent, get_decision, get_ledger, set_consent, set_fi_data
from backend.runner import evaluate_borrower

app = FastAPI(title="TrueLedger API")

# Cloud Run frontend and agent backend are separate services with separate
# URLs; wide open for the hackathon demo, tighten to the frontend's own
# origin before anything beyond a demo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/borrowers/{borrower_id}/evaluate")
async def evaluate(borrower_id: str) -> dict:
    try:
        return await evaluate_borrower(borrower_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/borrowers/{borrower_id}/ledger")
def ledger(borrower_id: str) -> dict:
    entries = get_ledger(borrower_id)
    if not entries:
        raise HTTPException(status_code=404, detail=f"No ledger entries yet for {borrower_id!r} - call evaluate first.")
    return {"borrower_id": borrower_id, "steps": entries}


@app.get("/borrowers/{borrower_id}/consent-status")
def consent_status(borrower_id: str) -> dict:
    try:
        consent_data = get_consent(borrower_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    statuses = [
        build_consent_status(source, meta["fi_type"], meta["expires_at"]).model_dump()
        for source, meta in consent_data.items()
    ]
    return {"borrower_id": borrower_id, "sources": statuses}


@app.post("/borrowers/upload")
async def upload_documents(
    loan_amount_requested: float = Form(...),
    bank_statement: UploadFile = File(...),
    gst_return: UploadFile = File(...),
    mutual_fund_statement: UploadFile | None = File(None),
    insurance_policy: UploadFile | None = File(None),
) -> dict:
    """Extracts real uploaded documents (via Gemini) into the same FI-schema
    shape the planted demo borrowers use, writes them under a brand new
    borrower_id, and returns that id - the caller then runs the existing
    POST /borrowers/{id}/evaluate exactly as it would for any other case.
    Bank statement + GST return are required (they drive the two core
    cross-checked signals); mutual fund / insurance are optional and simply
    leave that source empty, same as a real borrower who doesn't have one.
    """
    if loan_amount_requested <= 0:
        raise HTTPException(status_code=422, detail="loan_amount_requested must be greater than 0.")

    uploads: dict[str, UploadFile | None] = {
        "DEPOSIT": bank_statement,
        "GSTR1_3B": gst_return,
        "MUTUAL_FUNDS": mutual_fund_statement,
        "INSURANCE_POLICIES": insurance_policy,
    }

    extracted_by_source: dict[str, dict | None] = {}
    for doc_type, upload in uploads.items():
        if upload is None:
            extracted_by_source[doc_type] = None
            continue
        file_bytes = await upload.read()
        if not file_bytes:
            raise HTTPException(status_code=422, detail=f"The uploaded {doc_type} file was empty.")
        mime_type = upload.content_type or "application/pdf"
        try:
            _name = (upload.filename or "").lower()
            if _name.endswith((".xlsx", ".xlsm")) or "spreadsheetml" in (mime_type or ""):
                import io
                import openpyxl
                _wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
                _lines = []
                for _ws in _wb.worksheets:
                    _lines.append("# Sheet: " + str(_ws.title))
                    for _row in _ws.iter_rows(values_only=True):
                        if any(c is not None for c in _row):
                            _lines.append(",".join("" if c is None else str(c) for c in _row))
                file_bytes = "\n".join(_lines).encode("utf-8")
                mime_type = "text/plain"
            elif _name.endswith(".xls"):
                # openpyxl only reads the xlsx/xlsm zip-based format, not the
                # legacy binary .xls format - and "application/vnd.ms-excel"
                # is also the MIME type browsers legitimately send for a
                # real .xls file (not just a CSV with an Excel file
                # association), so it can't be used to route those bytes
                # into the plain-text branch below without risking sending
                # raw binary to Gemini mislabeled as text/plain.
                raise ValueError("Legacy .xls files aren't supported - please re-save as .xlsx or .csv and re-upload.")
            elif _name.endswith(".csv") or mime_type in ("text/csv", "application/csv"):
                mime_type = "text/plain"
            extracted_by_source[doc_type] = extract_source(doc_type, file_bytes, mime_type)
        except Exception as exc:
            # Boundary of the system: an arbitrary user-supplied file read by
            # an LLM can fail in ways we can't enumerate (unreadable scan,
            # wrong document type, model returned malformed JSON) - turn
            # any of them into one honest 4xx rather than a 500.
            raise HTTPException(
                status_code=422, detail=f"Could not read the uploaded {doc_type} document: {exc}"
            ) from exc

    fi_data = assemble_fi_data(extracted_by_source, loan_amount_requested)
    borrower_id = f"upload_{uuid.uuid4().hex[:10]}"
    set_fi_data(borrower_id, fi_data)
    set_consent(borrower_id, build_consent_block())
    return {"borrower_id": borrower_id}


@app.get("/borrowers/{borrower_id}/decision")
def decision(borrower_id: str) -> dict:
    """Convenience endpoint: the latest stored decision without re-running the pipeline."""
    result = get_decision(borrower_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No decision yet for {borrower_id!r} - call evaluate first.")
    return result
