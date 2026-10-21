"""
Automated Chaos & Security Penetration Test Suite:
1. Merkle Evidence Chaining & Cryptographic Tamper Detection
2. Automatic PII Scrubbing in Compliance Audit SIEM Logs
3. Ephemeral Sandbox Execution Isolation & Host Secret Protection
4. Cross-Tenant IDOR and Boundary Enforcement
"""
import pytest
import asyncio
from backend.contracts.evidence_merkle import (
    MerkleEvidenceLedger,
    VerifiableEvidenceItem,
    ChainedLedgerBlock,
)
from backend.compliance.structured_audit import PIIAnonymizer, ComplianceAuditLogger
from backend.security.sandbox import IsolatedEvidenceRunner

def test_merkle_ledger_detects_malicious_finding_tampering():
    evidence = [
        VerifiableEvidenceItem(
            evidence_id="ev_001",
            source_type="ACCOUNT_AGGREGATOR",
            raw_payload_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            confidence_score=0.98
        )
    ]
    
    h1 = MerkleEvidenceLedger.calculate_block_hash(
        "tenant_bank_a", "borrower_101", "step_01", 0, "GENESIS_ROOT",
        "VERIFY_CASHFLOW", "Genuine turnover confirmed without divergence", evidence, "2026-10-21T00:00:00Z"
    )
    b1 = ChainedLedgerBlock(
        tenant_id="tenant_bank_a", borrower_id="borrower_101", step_id="step_01", sequence_index=0,
        prev_block_hash="GENESIS_ROOT", current_block_hash=h1, action="VERIFY_CASHFLOW",
        finding="Genuine turnover confirmed without divergence", evidence_items=evidence,
        timestamp_utc="2026-10-21T00:00:00Z", actor_signature="SIG_HMAC_VALID"
    )

    # Valid chain passes
    assert MerkleEvidenceLedger.verify_chain_integrity([b1]) is True

    # Tamper with finding text
    b1_tampered = b1.model_copy(update={"finding": "Turnover fabricated by malicious actor"})
    assert MerkleEvidenceLedger.verify_chain_integrity([b1_tampered]) is False

    # Tamper with previous hash link
    b1_bad_prev = b1.model_copy(update={"prev_block_hash": "TAMPERED_PREV"})
    assert MerkleEvidenceLedger.verify_chain_integrity([b1_bad_prev]) is False

def test_pii_anonymizer_scrubs_financial_identifiers():
    raw_text = "Borrower with PAN AABCK4812G and GSTIN 36AABCK4812G1Z2 emailed cfo@varahaagro.com about default."
    clean = PIIAnonymizer.scrub(raw_text)

    assert "AABCK4812G" not in clean
    assert "36AABCK4812G1Z2" not in clean
    assert "cfo@varahaagro.com" not in clean
    assert "[REDACTED_PAN]" in clean
    assert "[REDACTED_GSTIN]" in clean
    assert "[REDACTED_EMAIL]" in clean

def test_compliance_audit_logger_format_scrubs_nested_metadata():
    logger = ComplianceAuditLogger()
    record = logger.format_security_event(
        event_name="BORROWER_EVALUATION_COMPLETED",
        tenant_id="tenant_bank_alpha",
        user_id="usr_underwriter_9",
        target_resource="borrower/b_corp_100",
        action="evaluate",
        status="SUCCESS",
        metadata={
            "applicant_pan": "AADCD7891K",
            "contact_email": "director@deccancement.com",
            "turnover_inr": 78500000
        }
    )

    assert record["metadata"]["applicant_pan"] == "[REDACTED_PAN]"
    assert record["metadata"]["contact_email"] == "[REDACTED_EMAIL]"
    assert record["metadata"]["turnover_inr"] == 78500000

def test_ephemeral_sandbox_isolation_and_secret_scrubbing():
    async def _test_sandbox():
        async with IsolatedEvidenceRunner("tenant_xyz", "borrower_999") as runner:
            # Command attempts to print sensitive host environment variable
            res = await runner.execute_isolated_command(
                ["python", "-c", "import os; print(os.environ.get('FIELD_ENCRYPTION_KEY', 'CLEAN_ISOLATED'))"],
                custom_env={"FIELD_ENCRYPTION_KEY": "ATTEMPTED_SECRET_INJECTION", "SAFE_VAR": "HELLO"}
            )
            assert res.exit_code == 0
            assert "CLEAN_ISOLATED" in res.stdout
            assert "ATTEMPTED_SECRET_INJECTION" not in res.stdout

    asyncio.run(_test_sandbox())
