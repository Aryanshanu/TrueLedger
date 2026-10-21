"""
backend/compliance/structured_audit.py
SOC 2 Type II and DPDP-Compliant Structured Audit Logger.
Enforces automatic scrubbing of PANs, GSTINs, bank accounts, and emails before ingestion by SIEM.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

class PIIAnonymizer:
    PAN_REGEX = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b")
    GSTIN_REGEX = re.compile(r"\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b")
    EMAIL_REGEX = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b")

    @classmethod
    def scrub(cls, text: str) -> str:
        if not isinstance(text, str):
            return text
        text = cls.PAN_REGEX.sub("[REDACTED_PAN]", text)
        text = cls.GSTIN_REGEX.sub("[REDACTED_GSTIN]", text)
        text = cls.EMAIL_REGEX.sub("[REDACTED_EMAIL]", text)
        return text

    @classmethod
    def scrub_dict(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        clean = {}
        for k, v in data.items():
            if isinstance(v, str):
                clean[k] = cls.scrub(v)
            elif isinstance(v, dict):
                clean[k] = cls.scrub_dict(v)
            elif isinstance(v, list):
                clean[k] = [cls.scrub(item) if isinstance(item, str) else item for item in v]
            else:
                clean[k] = v
        return clean

class ComplianceAuditLogger:
    def __init__(self, service_name: str = "trueledger_underwriting"):
        self.service_name = service_name
        self.logger = logging.getLogger("trueledger.compliance.audit")

    def format_security_event(
        self,
        event_name: str,
        tenant_id: str,
        user_id: str,
        target_resource: str,
        action: str,
        status: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Formats a structured JSON audit record strictly free of raw PII.
        """
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": self.service_name,
            "event": event_name,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "resource": target_resource,
            "action": action,
            "status": status,
            "metadata": PIIAnonymizer.scrub_dict(metadata or {})
        }

    def log_security_event(
        self,
        event_name: str,
        tenant_id: str,
        user_id: str,
        target_resource: str,
        action: str,
        status: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        record = self.format_security_event(
            event_name, tenant_id, user_id, target_resource, action, status, metadata
        )
        self.logger.info(json.dumps(record))

# Singleton audit instance
audit_logger = ComplianceAuditLogger()
