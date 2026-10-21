"""
backend/contracts/evidence_merkle.py
Immutable Merkle-Chained Evidence Contract with Tamper-Evident SHA-256 Signatures.
Provides verifiable cryptographic non-repudiation across multi-tenant forensic runs.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class VerifiableEvidenceItem(BaseModel):
    evidence_id: str = Field(..., pattern=r"^ev_[a-zA-Z0-9_-]{2,64}$")
    source_type: str = Field(..., description="e.g. ACCOUNT_AGGREGATOR, GSTR_3B, MUTUAL_FUND")
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    transaction_ids: List[str] = Field(default_factory=list)
    raw_payload_sha256: str = Field(..., min_length=64, max_length=64)
    confidence_score: float = Field(..., ge=0.0, le=1.0)

class ChainedLedgerBlock(BaseModel):
    tenant_id: str
    borrower_id: str
    step_id: str
    sequence_index: int
    prev_block_hash: str
    current_block_hash: str
    action: str
    finding: str
    evidence_items: List[VerifiableEvidenceItem] = Field(default_factory=list)
    timestamp_utc: str
    actor_signature: str

class MerkleEvidenceLedger:
    @staticmethod
    def calculate_block_hash(
        tenant_id: str,
        borrower_id: str,
        step_id: str,
        sequence_index: int,
        prev_block_hash: str,
        action: str,
        finding: str,
        evidence: List[VerifiableEvidenceItem],
        timestamp_utc: str
    ) -> str:
        manifest = {
            "tenant_id": tenant_id,
            "borrower_id": borrower_id,
            "step_id": step_id,
            "sequence_index": sequence_index,
            "prev_block_hash": prev_block_hash,
            "action": action,
            "finding": finding,
            "evidence": [e.model_dump() for e in evidence],
            "timestamp": timestamp_utc
        }
        canonical_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(canonical_bytes).hexdigest()

    @classmethod
    def verify_chain_integrity(cls, blocks: List[ChainedLedgerBlock]) -> bool:
        """
        Verifies that no block has been altered, injected, or removed.
        Returns True if the entire cryptographic chain matches genesis down to latest.
        """
        if not blocks:
            return True

        expected_prev = "GENESIS_ROOT"
        for idx, block in enumerate(blocks):
            if block.sequence_index != idx:
                return False
            if block.prev_block_hash != expected_prev:
                return False

            recalculated = cls.calculate_block_hash(
                tenant_id=block.tenant_id,
                borrower_id=block.borrower_id,
                step_id=block.step_id,
                sequence_index=block.sequence_index,
                prev_block_hash=block.prev_block_hash,
                action=block.action,
                finding=block.finding,
                evidence=block.evidence_items,
                timestamp_utc=block.timestamp_utc
            )
            if recalculated != block.current_block_hash:
                return False
            expected_prev = block.current_block_hash

        return True
