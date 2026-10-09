"""Real-document ingestion: turns an uploaded bank statement / GST return /
mutual fund statement / insurance policy (PDF or image) into the exact same
FI-schema shape `data/synthetic/borrowers.py` builds for the planted demo
borrowers (see docs/DATA_SCHEMA.md). Once this module hands back that shape,
the rest of the pipeline - bank_agent.py, gst_agent.py, investment_agent.py,
rules.py, consent.py, orchestrator_agent.py - runs completely unmodified on
it. This is deliberately additive: no existing agent, rule, or schema file
is touched.

What the model is and is not allowed to do:
    - It reads a real uploaded document and extracts fields that are
      actually printed on it (dates, amounts, CREDIT/DEBIT, declared
      turnover, scheme/policy names, sums assured). It is explicitly told
      to leave a field out rather than guess one that isn't legible.
    - It never invents a `txn_id` or `policy_id` - most real statements
      don't print an internal reference a system like this would use for
      citation, so Python assigns a stable local key (`up_txn_001`, ...)
      after extraction purely so the ledger has something to cite. That key
      is a pointer we create, not a fact we're claiming about the document.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal, Optional

from pydantic import BaseModel, Field

from agents import config

# --- Extraction schemas (one per FI source type) ---
# Deliberately separate from agents/schemas.py's Claim/AgentFindings - those
# describe an *agent's cited finding*; these describe *raw fields read off a
# document*, before any citation key is attached.


class ExtractedTransaction(BaseModel):
    date: str = Field(description="ISO date YYYY-MM-DD as printed on the statement.")
    amount: float = Field(description="Absolute transaction amount, no sign.")
    type: Literal["CREDIT", "DEBIT"]
    narration: str = Field(default="", description="The transaction description/narration as printed, if any.")


class ExtractedDeposit(BaseModel):
    account_holder: str = ""
    current_balance: float = 0.0
    transactions: list[ExtractedTransaction] = []


class ExtractedGstReturn(BaseModel):
    period: str = Field(description="Filing period as YYYY-MM.")
    declared_turnover: float
    filed_on_time: bool = Field(description="True if filed on/before the due date; false if filed late.")


class ExtractedGst(BaseModel):
    gstin: str = ""
    legal_name: str = ""
    returns: list[ExtractedGstReturn] = []


class ExtractedHolding(BaseModel):
    scheme: str
    current_value: float


class ExtractedMutualFunds(BaseModel):
    investor_name: str = ""
    holdings: list[ExtractedHolding] = []


class ExtractedPolicy(BaseModel):
    sum_assured: float


class ExtractedInsurance(BaseModel):
    policy_holder: str = ""
    policies: list[ExtractedPolicy] = []


_SCHEMA_BY_SOURCE: dict[str, type[BaseModel]] = {
    "DEPOSIT": ExtractedDeposit,
    "GSTR1_3B": ExtractedGst,
    "MUTUAL_FUNDS": ExtractedMutualFunds,
    "INSURANCE_POLICIES": ExtractedInsurance,
}

_PROMPT_BY_SOURCE: dict[str, str] = {
    "DEPOSIT": (
        "This is a bank account statement. Extract the account holder's name, the "
        "current/closing balance, and every transaction line: its date, amount, "
        "whether it is a CREDIT (money in) or DEBIT (money out), and its narration "
        "if printed. Read every transaction row on every page - do not summarize or "
        "sample. If a field is not legible or not present, omit it or leave it "
        "empty rather than guessing a value."
    ),
    "GSTR1_3B": (
        "This is a GST return (GSTR-1 or GSTR-3B) or a filing summary covering one "
        "or more periods. Extract the GSTIN, legal name, and for each filing period: "
        "the period as YYYY-MM, the declared turnover for that period, and whether "
        "it was filed on time (compare the filing date to the statutory due date if "
        "both are printed; otherwise leave filed_on_time as your best reading of any "
        "explicit 'late fee' / 'filed late' indicator - never guess if there is no "
        "evidence either way, default to true only when nothing suggests lateness)."
    ),
    "MUTUAL_FUNDS": (
        "This is a mutual fund / consolidated account statement (CAS). Extract the "
        "investor's name and every distinct scheme/fund holding with its current "
        "value. If the same scheme appears multiple times (e.g. different folios), "
        "list each holding separately."
    ),
    "INSURANCE_POLICIES": (
        "This is an insurance policy document or schedule. Extract the policy "
        "holder's name and the sum assured for every policy listed."
    ),
}

RESPONSE_PROMPT_SUFFIX = (
    "\n\nRespond with ONLY the JSON object matching the given schema - no prose, no "
    "markdown fences. Every number must be read directly off the document, never "
    "estimated or rounded for convenience."
)


@lru_cache(maxsize=1)
def _client():
    # Imported lazily, same reasoning as firestore_gateway._client: tests
    # that never touch extraction should not need google-genai credentials.
    from google import genai

    return genai.Client(
        vertexai=True,
        project=config.GOOGLE_CLOUD_PROJECT or None,
        location=config.VERTEX_AI_LOCATION,
    )


async def extract_source(doc_type: str, file_bytes: bytes, mime_type: str) -> dict:
    """Calls Gemini once on one uploaded document and returns it already
    mapped into the pipeline's FI source shape (see `_to_source_shape`).

    Deliberately `async` using the SDK's `client.aio` surface, not the sync
    `client.models` call wrapped in a blocking call - a sync network call
    made directly inside an `async def` FastAPI endpoint (as this one
    originally was) blocks the whole event loop for the call's full
    real-world latency, serializing every concurrent request the process
    is handling, not just this one. `backend/main.py`'s upload endpoint
    awaits several of these concurrently via `asyncio.gather`."""
    from google.genai import types

    schema = _SCHEMA_BY_SOURCE[doc_type]
    prompt = _PROMPT_BY_SOURCE[doc_type] + RESPONSE_PROMPT_SUFFIX

    response = await _client().aio.models.generate_content(
        model=config.SPECIALIST_MODEL,
        contents=[prompt, types.Part.from_bytes(data=file_bytes, mime_type=mime_type)],
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema),
    )
    if not response.text:
        raise ValueError(f"Gemini returned no extractable content for a {doc_type} document.")
    extracted = schema.model_validate_json(response.text)
    return _to_source_shape(doc_type, extracted.model_dump())


def _to_source_shape(doc_type: str, extracted: dict) -> dict:
    """Maps one extracted dict (or the empty stub below) into the exact
    Profile/Summary/Transactions-or-equivalent shape every tools.py compute
    function expects (docs/DATA_SCHEMA.md) - the same shape
    data/synthetic/borrowers.py builds for the planted demo borrowers, so
    the rest of the pipeline cannot tell a real upload from synthetic data.
    txn_id/policy_id are assigned here, not extracted (see module docstring):
    most real statements don't print an internal reference this system
    would use for citation."""
    if doc_type == "DEPOSIT":
        transactions = extracted["transactions"]
        for i, txn in enumerate(transactions, start=1):
            txn["txn_id"] = f"up_txn_{i:03d}"
        return {
            "fi_type": "DEPOSIT",
            "profile": {"account_holder": extracted["account_holder"]},
            "summary": {"current_balance": extracted["current_balance"], "currency": "INR"},
            "transactions": transactions,
        }
    if doc_type == "GSTR1_3B":
        return {
            "fi_type": "GSTR1_3B",
            "profile": {"gstin": extracted["gstin"], "legal_name": extracted["legal_name"]},
            "summary": {"filing_frequency": "monthly"},
            "returns": extracted["returns"],
        }
    if doc_type == "MUTUAL_FUNDS":
        holdings = extracted["holdings"]
        total_value = round(sum(h["current_value"] for h in holdings), 2)
        return {
            "fi_type": "MUTUAL_FUNDS",
            "profile": {"investor_name": extracted["investor_name"]},
            "summary": {"total_current_value": total_value},
            "holdings": holdings,
        }
    if doc_type == "INSURANCE_POLICIES":
        policies = extracted["policies"]
        for i, policy in enumerate(policies, start=1):
            policy["policy_id"] = f"up_pol_{i:03d}"
        total_sum_assured = round(sum(p["sum_assured"] for p in policies), 2)
        return {
            "fi_type": "INSURANCE_POLICIES",
            "profile": {"policy_holder": extracted["policy_holder"]},
            "summary": {"total_sum_assured": total_sum_assured},
            "policies": policies,
        }
    raise ValueError(f"Unknown FI source type: {doc_type!r}")


def empty_source_stub(doc_type: str) -> dict:
    """The extracted-dict shape a source takes when its document was not
    uploaded at all (e.g. mutual funds / insurance are optional) - zero
    holdings/policies, never a fabricated placeholder value. The
    deterministic tool functions in agents/tools.py already handle an empty
    list/zero total correctly (liquid_assets -> "low", insurance_coverage ->
    "gap"/"unknown")."""
    stubs: dict[str, dict] = {
        "DEPOSIT": {"account_holder": "", "current_balance": 0.0, "transactions": []},
        "GSTR1_3B": {"gstin": "", "legal_name": "", "returns": []},
        "MUTUAL_FUNDS": {"investor_name": "", "holdings": []},
        "INSURANCE_POLICIES": {"policy_holder": "", "policies": []},
    }
    return stubs[doc_type]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def build_consent_block(now: datetime | None = None, days: int = 90) -> dict:
    """Fresh consent for all three findings sources, granted now by the
    person uploading their own documents. `days` defaults to a 90-day AA
    consent window - a real policy choice this feature makes, not a claim
    about any borrower. Same shape as
    `data/synthetic/borrowers.py::_consent_block`."""
    now = now or datetime.now(timezone.utc)
    expires_at = _iso(now + timedelta(days=days))
    return {
        "bank_findings": {"fi_type": "DEPOSIT", "expires_at": expires_at},
        "gst_findings": {"fi_type": "GSTR1_3B", "expires_at": expires_at},
        "investment_findings": {"fi_type": "MUTUAL_FUNDS+INSURANCE_POLICIES", "expires_at": expires_at},
    }


def assemble_fi_data(extracted_by_source: dict[str, Optional[dict]], loan_amount_requested: float) -> dict:
    """Pure, network-free: builds the exact `fi_data/{borrower_id}` document
    shape (see agents/config.py's Firestore layout comment) from per-source
    dicts already in pipeline shape (i.e. already run through
    `extract_source`/`_to_source_shape`). A source mapped to None (not
    uploaded) gets the empty stub instead - every one of the four top-level
    keys must exist because bank_agent.py/gst_agent.py/investment_agent.py
    look them up with `fi_data["sources"]["X"]`, not `.get("X")`."""
    sources: dict[str, dict] = {}
    for doc_type in ("DEPOSIT", "GSTR1_3B", "MUTUAL_FUNDS", "INSURANCE_POLICIES"):
        body = extracted_by_source.get(doc_type)
        sources[doc_type] = body if body is not None else _to_source_shape(doc_type, empty_source_stub(doc_type))
    return {"sources": sources, "loan_amount_requested": loan_amount_requested}
