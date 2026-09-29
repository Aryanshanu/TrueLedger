"""Thin Firestore read/write helpers shared by the agent tools, the
orchestrator, the ledger writer, and the backend API.

Firestore layout (see agents/config.py):
    fi_data/{borrower_id}          -> {"sources": {...}, "loan_amount_requested": ...}
    consent/{borrower_id}          -> {"bank_findings": {...}, "gst_findings": {...}, "investment_findings": {...}}
    claims/{borrower_id}/agents/{bank_statement_agent|gst_tax_agent|investment_agent}
    ledger/{step_id}
    decisions/{borrower_id}
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from agents import config


@lru_cache(maxsize=1)
def _client():
    # Imported lazily so unit tests that never touch Firestore (tools.py,
    # rules.py, consent.py) do not need google-cloud-firestore installed
    # or GCP credentials configured.
    from google.cloud import firestore

    return firestore.Client(project=config.GOOGLE_CLOUD_PROJECT or None)


def get_fi_data(borrower_id: str) -> dict[str, Any]:
    doc = _client().collection(config.FIRESTORE_FI_DATA_COLLECTION).document(borrower_id).get()
    if not doc.exists:
        raise KeyError(f"No FI data for borrower_id={borrower_id!r}")
    return doc.to_dict()


def set_fi_data(borrower_id: str, data: dict[str, Any]) -> None:
    _client().collection(config.FIRESTORE_FI_DATA_COLLECTION).document(borrower_id).set(data)


def get_consent(borrower_id: str) -> dict[str, Any]:
    doc = _client().collection(config.FIRESTORE_CONSENT_COLLECTION).document(borrower_id).get()
    if not doc.exists:
        raise KeyError(f"No consent record for borrower_id={borrower_id!r}")
    return doc.to_dict()


def set_consent(borrower_id: str, data: dict[str, Any]) -> None:
    _client().collection(config.FIRESTORE_CONSENT_COLLECTION).document(borrower_id).set(data)


def write_claims(borrower_id: str, agent: str, findings: dict[str, Any]) -> None:
    (
        _client()
        .collection(config.FIRESTORE_CLAIMS_COLLECTION)
        .document(borrower_id)
        .collection("agents")
        .document(agent)
        .set(findings)
    )


def append_ledger_entry(entry: dict[str, Any]) -> None:
    """Append-only write: each step_id is its own document, never overwritten."""
    _client().collection(config.FIRESTORE_LEDGER_COLLECTION).document(entry["step_id"]).set(entry)


def get_ledger(borrower_id: str) -> list[dict[str, Any]]:
    # A single-field equality filter is auto-indexed by Firestore; adding
    # .order_by() on a *different* field turns this into a composite query
    # that needs a manually-created index (Firestore returns a
    # FailedPrecondition error with a console link to create one on first
    # use - confirmed live against a real project). A borrower's ledger is
    # small (dozens of steps, not millions), so sorting in Python after the
    # fetch avoids that index dependency entirely rather than asking every
    # judge/demo environment to pre-create one.
    from google.cloud import firestore

    query = _client().collection(config.FIRESTORE_LEDGER_COLLECTION).where(
        filter=firestore.FieldFilter("borrower_id", "==", borrower_id)
    )
    entries = [d.to_dict() for d in query.stream()]
    entries.sort(key=lambda e: e["timestamp"])
    return entries


def set_decision(borrower_id: str, decision: dict[str, Any]) -> None:
    _client().collection(config.FIRESTORE_DECISIONS_COLLECTION).document(borrower_id).set(decision)


def get_decision(borrower_id: str) -> dict[str, Any] | None:
    doc = _client().collection(config.FIRESTORE_DECISIONS_COLLECTION).document(borrower_id).get()
    return doc.to_dict() if doc.exists else None
