"""Cloud Run API service wrapping the agent pipeline.

Endpoints (per the build brief's API contract sketch):
    POST /borrowers/{id}/evaluate        -> triggers the pipeline, returns final decision
    GET  /borrowers/{id}/ledger          -> full ordered list of ledger steps for replay
    GET  /borrowers/{id}/consent-status  -> per-source days-remaining and confidence multiplier
    GET  /health                         -> liveness check for Cloud Run
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from agents.consent import build_consent_status
from agents.firestore_gateway import get_consent, get_decision, get_ledger
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


@app.get("/borrowers/{borrower_id}/decision")
def decision(borrower_id: str) -> dict:
    """Convenience endpoint: the latest stored decision without re-running the pipeline."""
    result = get_decision(borrower_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No decision yet for {borrower_id!r} - call evaluate first.")
    return result
