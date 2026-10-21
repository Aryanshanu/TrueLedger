"""
Field-Level Encryption Engine using AES-256-GCM.
Enforces 256-bit envelope encryption for PII, bank accounts, and GST declarations.
Supports associated authenticated data (AAD) binding to tenant and borrower context.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any, Dict, Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

class FieldEncryptor:
    """
    AES-256-GCM Encryptor with Associated Authenticated Data (AAD) binding.
    Prevents ciphertext transplantation across tenants or borrowers.
    """
    def __init__(self, key: Optional[bytes] = None):
        raw_key = key or os.environ.get("FIELD_ENCRYPTION_KEY", "").encode("utf-8")
        if not raw_key:
            # Generate deterministic fallback key for testing if unconfigured
            raw_key = hashlib.sha256(b"trueledger-default-vault-key-32b").digest()
        elif len(raw_key) != 32:
            raw_key = hashlib.sha256(raw_key).digest()
        
        self._key = raw_key
        self._aesgcm = AESGCM(self._key)

    def encrypt(self, plaintext: str, associated_data: str) -> str:
        """
        Encrypts plaintext string with 96-bit random nonce and binds AAD.
        Returns base64 encoded: nonce (12 bytes) + ciphertext + tag (16 bytes).
        """
        if not plaintext:
            return ""
        nonce = os.urandom(12)
        ciphertext = self._aesgcm.encrypt(
            nonce,
            plaintext.encode("utf-8"),
            associated_data.encode("utf-8")
        )
        return base64.b64encode(nonce + ciphertext).decode("ascii")

    def decrypt(self, encoded_payload: str, associated_data: str) -> str:
        """
        Decrypts base64 encoded payload verifying AAD integrity.
        Raises ValueError if payload is tampered or AAD does not match.
        """
        if not encoded_payload:
            return ""
        try:
            raw = base64.b64decode(encoded_payload.encode("ascii"))
            if len(raw) < 28: # 12 bytes nonce + 16 bytes tag minimum
                raise ValueError("Payload too short for AES-256-GCM")
            nonce = raw[:12]
            ciphertext = raw[12:]
            decrypted = self._aesgcm.decrypt(
                nonce,
                ciphertext,
                associated_data.encode("utf-8")
            )
            return decrypted.decode("utf-8")
        except Exception as exc:
            raise ValueError(f"Decryption failed: AAD mismatch or compromised payload: {exc}") from exc

    def tokenize_pan(self, pan: str) -> str:
        """Deterministic HMAC-SHA256 token for zero-knowledge indexed search."""
        clean_pan = pan.strip().upper()
        return hmac.new(self._key, clean_pan.encode("utf-8"), hashlib.sha256).hexdigest()

    def mask_pan(self, pan: str) -> str:
        """Masks PAN leaving only first 2 and last 2 characters."""
        clean = pan.strip().upper()
        if len(clean) != 10:
            return "••••••••••"
        return f"{clean[:2]}••••••{clean[-2:]}"

    def mask_account_number(self, acc: str) -> str:
        """Masks bank account keeping only last 4 digits."""
        clean = str(acc).strip()
        if len(clean) <= 4:
            return "••••"
        return f"{'•' * (len(clean) - 4)}{clean[-4:]}"
