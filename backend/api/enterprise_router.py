"""
Enterprise SaaS API Router.
Exposes multi-tenant borrower onboarding, async evaluation, ledger audits, and compliance exports.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from backend.core.tenancy import TenantContext, UserRole, get_tenant_context
from backend.storage.repository import EnterpriseTenantRepository
from backend.resilience.circuit_breaker import gemini_circuit_breaker
from backend.runner import evaluate_borrower

logger = logging.getLogger("trueledger.enterprise.api")
enterprise_router = APIRouter(prefix="/v1/enterprise", tags=["Enterprise Underwriting"])

class OnboardBorrowerRequest(BaseModel):
    borrower_id: str = Field(..., min_length=3, max_length=64, description="Unique borrower ID")
    legal_name: str = Field(..., min_length=2, max_length=128)
    pan: str = Field(..., pattern=r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$")
    gstin: Optional[str] = Field(None, pattern=r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$")
    annual_turnover_inr: float = Field(..., gt=0)

class EvaluationResponse(BaseModel):
    tenant_id: str
    borrower_id: str
    status: str
    outcome: Optional[str] = None
    final_confidence: Optional[float] = None
    ledger_step_count: int

@enterprise_router.post("/borrowers/onboard", status_code=status.HTTP_201_CREATED)
async def onboard_borrower(
    req: OnboardBorrowerRequest,
    ctx: TenantContext = Depends(get_tenant_context)
):
    """Onboards a borrower record strictly scoped to the active tenant."""
    ctx.require_role(UserRole.UNDERWRITER)
    repo = EnterpriseTenantRepository()
    
    # Commit initial audit step
    step = repo.append_ledger_step_transactional(
        borrower_id=req.borrower_id,
        step_id=f"step_{req.borrower_id}_intake",
        agent_name="onboarding_gateway",
        action="onboard_borrower_record",
        claim_data={
            "legal_name": req.legal_name,
            "pan_token": repo._encryptor.tokenize_pan(req.pan),
            "masked_pan": repo._encryptor.mask_pan(req.pan),
            "turnover": req.annual_turnover_inr
        },
        confidence=1.0,
        notes=f"Entity {req.legal_name} onboarded by {ctx.user_id} under tenant {ctx.tenant_id}"
    )
    return {
        "status": "success",
        "tenant_id": ctx.tenant_id,
        "borrower_id": req.borrower_id,
        "intake_block_digest": step["block_digest"]
    }

@enterprise_router.post("/borrowers/{borrower_id}/audit-run", response_model=EvaluationResponse)
async def trigger_forensic_audit(
    borrower_id: str,
    ctx: TenantContext = Depends(get_tenant_context)
):
    """
    Executes the deterministic forensics engine wrapped in the Circuit Breaker.
    """
    ctx.require_role(UserRole.UNDERWRITER)
    
    # Run through circuit breaker protection
    try:
        decision_dict = await gemini_circuit_breaker.execute(evaluate_borrower, borrower_id)
    except Exception as exc:
        logger.error("Audit pipeline execution failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Forensic engine unavailable or circuit open: {str(exc)}"
        )

    return EvaluationResponse(
        tenant_id=ctx.tenant_id,
        borrower_id=borrower_id,
        status="completed",
        outcome=decision_dict.get("outcome"),
        final_confidence=decision_dict.get("final_confidence"),
        ledger_step_count=len(decision_dict.get("ledger_step_ids", []))
    )

@enterprise_router.get("/borrowers/{borrower_id}/ledger")
async def get_verified_ledger(
    borrower_id: str,
    ctx: TenantContext = Depends(get_tenant_context)
):
    """Fetches the complete tenant-isolated cryptographic ledger."""
    ctx.require_role(UserRole.UNDERWRITER)
    repo = EnterpriseTenantRepository()
    ledger = repo.get_borrower_ledger(borrower_id)
    return {
        "tenant_id": ctx.tenant_id,
        "borrower_id": borrower_id,
        "total_steps": len(ledger),
        "steps": ledger
    }
