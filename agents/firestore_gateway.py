"""Thin Firestore read/write helpers shared by the agent tools, the
orchestrator, the ledger writer, and the backend API.

Firestore layout (see agents/config.py):
    fi_data/{borrower_id}          -> {"sources": {...}, "loan_amount_requested": ...}
    consent/{borrower_id}          -> {"bank_findings": {...}, "gst_findings": {...}, "investment_findings": {...}}
    claims/{borrower_id}/agents/{bank_statement_agent|gst_tax_agent|investment_agent}
    ledger/{step_id}
    ledger_counters/{borrower_id}  -> {"count": <int>}, used only to allocate step_ids
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


def _format_step_id(borrower_id: str, seq: int) -> str:
    """Pure formatting, split out from allocate_next_step_id so the id
    shape is unit-testable without mocking Firestore's transaction
    machinery."""
    return f"stp_{borrower_id}_{seq:05d}"


def allocate_next_step_id(borrower_id: str) -> str:
    """Atomically allocates the next ledger step_id for `borrower_id`.

    Previously, agents/ledger.py computed this as
    `f"stp_{len(get_ledger(borrower_id)) + 1:05d}"` - a read-then-compute
    with no transaction, so (a) two concurrent writes for the SAME
    borrower could both read the same count and produce the same
    step_id, and append_ledger_entry's `.set()` would then silently
    overwrite one entry with the other, and (b) because the id carried no
    borrower_id and every borrower's count restarts at 0, borrower A's
    `stp_00001` and borrower B's `stp_00001` collided in the single global
    `ledger` collection even with no concurrency at all - evaluating a
    second borrower would silently overwrite the first borrower's step 1.
    A Firestore transaction on a per-borrower counter document fixes (a);
    embedding borrower_id in the id fixes (b) even if the transaction were
    ever bypassed.
    """
    from google.cloud import firestore

    client = _client()
    counter_ref = client.collection("ledger_counters").document(borrower_id)

    @firestore.transactional
    def _increment(transaction: "firestore.Transaction") -> int:
        snapshot = counter_ref.get(transaction=transaction)
        current = snapshot.get("count") if snapshot.exists else 0
        next_count = (current or 0) + 1
        transaction.set(counter_ref, {"count": next_count})
        return next_count

    seq = _increment(client.transaction())
    return _format_step_id(borrower_id, seq)


def append_ledger_entry(entry: dict[str, Any]) -> None:
    """Append-only write: each step_id is its own document, never overwritten."""
    _client().collection(config.FIRESTORE_LEDGER_COLLECTION).document(entry["step_id"]).set(entry)


def commit_final_ledger_entry_and_decision(
    borrower_id: str, ledger_entry: dict[str, Any], decision: dict[str, Any]
) -> None:
    """Atomically writes the orchestrator's final-decision ledger entry and
    the borrower's `decisions/{borrower_id}` document together.

    Previously these were two independent `.set()` calls (append_ledger_entry
    then set_decision) - if the process died or a call failed in between
    (a dropped connection, Cloud Run killing the instance mid-request), the
    ledger would show a "final_decision" entry with no matching
    `decisions/{borrower_id}` document, or `decisions/{borrower_id}` would
    hold a stale decision the ledger's own last entry no longer agrees
    with. A Firestore batched write commits every write together or none
    at all, which is exactly the guarantee needed here - there is no read
    in this step, so a (heavier) transaction isn't necessary, just atomic
    writes.
    """
    client = _client()
    batch = client.batch()
    batch.set(
        client.collection(config.FIRESTORE_LEDGER_COLLECTION).document(ledger_entry["step_id"]),
        ledger_entry,
    )
    batch.set(
        client.collection(config.FIRESTORE_DECISIONS_COLLECTION).document(borrower_id),
        decision,
    )
    batch.commit()


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
