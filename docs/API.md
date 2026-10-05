# API contract (backend <-> frontend)

Base URL: the deployed backend's Cloud Run URL (injected into the frontend
container as `BACKEND_URL`, see `frontend/server.js`).

| Method | Path | Description |
|---|---|---|
| `POST` | `/borrowers/{id}/evaluate` | Triggers the pipeline, returns the final `Decision` |
| `GET` | `/borrowers/{id}/ledger` | Full ordered list of ledger steps for replay |
| `GET` | `/borrowers/{id}/consent-status` | Per-source days-remaining and confidence multiplier |
| `GET` | `/borrowers/{id}/decision` | The latest stored decision without re-running the pipeline |
| `POST` | `/borrowers/upload` | Extracts real uploaded documents (via Gemini) into a brand new `borrower_id` |
| `GET` | `/health` | Liveness check |

## `POST /borrowers/{id}/evaluate`

Runs the full ADK pipeline (parallel specialists -> orchestrator) for one
borrower and returns `agents.schemas.Decision` as JSON:

```json
{
  "borrower_id": "b_contradiction",
  "outcome": "manual_review",
  "final_confidence": 0.5,
  "model_confidence": 0.5,
  "weakest_consent_source": "bank_findings",
  "contradictions": [ { "rule": "...", "metric": "...", "finding": "...", "evidence": [...], "action": "..." } ],
  "risk_factors": [ ... ],
  "ledger_step_ids": ["stp_00009"],
  "generated_at": "2026-10-07T09:14:22Z"
}
```

## `GET /borrowers/{id}/ledger`

```json
{ "borrower_id": "b_contradiction", "steps": [ /* LedgerEntry, ordered by timestamp */ ] }
```

## `GET /borrowers/{id}/consent-status`

```json
{
  "borrower_id": "b_stale_consent",
  "sources": [
    { "source": "bank_findings", "fi_type": "DEPOSIT", "expires_at": "...", "days_remaining": 2, "confidence_multiplier": 0.2857 },
    { "source": "gst_findings", "fi_type": "GSTR1_3B", "expires_at": "...", "days_remaining": 30, "confidence_multiplier": 1.0 },
    { "source": "investment_findings", "fi_type": "MUTUAL_FUNDS+INSURANCE_POLICIES", "expires_at": "...", "days_remaining": 30, "confidence_multiplier": 1.0 }
  ]
}
```

Errors are plain FastAPI `HTTPException` JSON (`{"detail": "..."}`) with
`404` when a borrower has no FI data / no ledger yet.

## `POST /borrowers/upload`

`multipart/form-data`, not JSON:

| Field | Required | Notes |
|---|---|---|
| `loan_amount_requested` | yes | number, > 0 |
| `bank_statement` | yes | PDF/PNG/JPEG |
| `gst_return` | yes | PDF/PNG/JPEG |
| `mutual_fund_statement` | no | PDF/PNG/JPEG |
| `insurance_policy` | no | PDF/PNG/JPEG |

```json
{ "borrower_id": "upload_a1b2c3d4e5" }
```

The caller then runs the returned `borrower_id` through the exact same
`POST /borrowers/{id}/evaluate` / `GET .../ledger` / `GET .../consent-status`
calls as any other case - see `docs/DATA_SCHEMA.md` for what extraction does
and does not do, and `agents/extraction.py` for the implementation. A `422`
with `{"detail": "..."}` means either `loan_amount_requested` wasn't a
positive number or a document could not be read (unreadable scan, wrong
document type, malformed model response) - the detail names which one.
