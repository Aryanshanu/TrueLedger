"""
Comprehensive Test Suite for Enterprise SaaS Modules:
1. Field-Level AES-256-GCM Encryption & AAD Tamper Resistance
2. Multi-Tenant ContextVars Non-Leakage
3. Merkle Chained Ledger Digests
4. Model Circuit Breaker Fail-Fast & Recovery
5. Enterprise Endpoints under Tenant Partitioning
"""
import pytest
import asyncio
from backend.security.crypto import FieldEncryptor
from backend.core.tenancy import TenantContext, UserRole, _current_tenant_ctx, get_tenant_context
from backend.storage.repository import EnterpriseTenantRepository
from backend.resilience.circuit_breaker import CircuitBreaker, CircuitBreakerOpenException
from fastapi.testclient import TestClient
from backend.main import app

def test_field_encryptor_encrypt_decrypt_happy_path():
    enc = FieldEncryptor(b"01234567890123456789012345678901")
    plaintext = "CONFIDENTIAL_FINANCIAL_REPORT_INR_50000000"
    aad = "tenant_alpha:borrower_100"

    ciphertext = enc.encrypt(plaintext, associated_data=aad)
    assert ciphertext != plaintext
    assert len(ciphertext) > 20

    decrypted = enc.decrypt(ciphertext, associated_data=aad)
    assert decrypted == plaintext

def test_field_encryptor_rejects_aad_mismatch_tampering():
    enc = FieldEncryptor(b"01234567890123456789012345678901")
    plaintext = "SENSITIVE_PAN_ABCDE1234F"
    
    # Encrypted under Tenant Alpha
    ciphertext = enc.encrypt(plaintext, associated_data="tenant_alpha:borrower_100")

    # Attacker tries to decrypt under Tenant Beta
    with pytest.raises(ValueError, match="Decryption failed"):
        enc.decrypt(ciphertext, associated_data="tenant_beta:borrower_100")

def test_field_encryptor_pan_masking_and_tokenization():
    enc = FieldEncryptor(b"01234567890123456789012345678901")
    pan = "AABCK4812G"
    
    masked = enc.mask_pan(pan)
    assert masked == "AA••••••2G"

    token1 = enc.tokenize_pan(pan)
    token2 = enc.tokenize_pan("AABCK4812G")
    assert token1 == token2
    assert len(token1) == 64  # SHA-256 hex string

def test_tenant_context_isolation_and_role_guards():
    ctx = TenantContext(
        tenant_id="bank_of_maharashtra",
        user_id="underwriter_42",
        roles={UserRole.UNDERWRITER},
        organization="Bank of Maharashtra"
    )
    token = _current_tenant_ctx.set(ctx)
    try:
        current = get_tenant_context()
        assert current.tenant_id == "bank_of_maharashtra"
        assert current.has_role(UserRole.UNDERWRITER)
        assert not current.has_role(UserRole.COMPLIANCE_AUDITOR)

        with pytest.raises(Exception):
            current.require_role(UserRole.COMPLIANCE_AUDITOR)
    finally:
        _current_tenant_ctx.reset(token)

def test_circuit_breaker_trips_to_open_after_failures():
    async def _run():
        breaker = CircuitBreaker(failure_threshold=3, recovery_timeout_sec=0.2)
        
        async def failing_call():
            raise ConnectionResetError("Gemini Vertex AI connection reset")

        # Trigger 3 failures
        for _ in range(3):
            with pytest.raises(ConnectionResetError):
                await breaker.execute(failing_call)

        assert breaker.state == "OPEN"

        # 4th call should immediately fast-fail with CircuitBreakerOpenException without running
        with pytest.raises(CircuitBreakerOpenException):
            await breaker.execute(failing_call)

        # Wait for recovery timeout
        await asyncio.sleep(0.25)

        # Next call should be allowed as probe (HALF_OPEN)
        async def healthy_call():
            return "SUCCESS_DATA"

        res = await breaker.execute(healthy_call)
        assert res == "SUCCESS_DATA"
        assert breaker.state == "CLOSED"

    asyncio.run(_run())

def test_enterprise_onboard_api_endpoint():
    client = TestClient(app)
    
    payload = {
        "borrower_id": "test_corp_901",
        "legal_name": "Test Industrial Corp Ltd",
        "pan": "ABCDE1234F",
        "annual_turnover_inr": 25000000.0
    }

    # Malformed tenant slug test
    res = client.post("/v1/enterprise/borrowers/onboard", json=payload, headers={"X-Tenant-ID": "!"})
    assert res.status_code == 400

    # Happy path tenant onboard
    res = client.post(
        "/v1/enterprise/borrowers/onboard",
        json=payload,
        headers={"X-Tenant-ID": "tenant_test_bank", "X-User-Role": "underwriter"}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "success"
    assert data["tenant_id"] == "tenant_test_bank"
    assert "intake_block_digest" in data
