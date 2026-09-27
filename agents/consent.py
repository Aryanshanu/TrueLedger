"""Consent-expiry confidence decay.

    c(d) = 1        if d > 7
         = d / 7     if 0 < d <= 7
         = 0         if d <= 0

Confidence holds at full strength until a source's AA consent is close to
expiring, then decays linearly to zero, forcing re-consent before a stale
source can quietly carry a decision. The final confidence for a decision is
the model's own confidence multiplied by the *weakest* source's c(d) - one
stale consent caps the whole decision, it does not get averaged away by the
other, fresher sources.
"""

from __future__ import annotations

from datetime import datetime, timezone

from agents.schemas import ConsentSourceStatus


def confidence_multiplier(days_remaining: int) -> float:
    if days_remaining > 7:
        return 1.0
    if days_remaining <= 0:
        return 0.0
    return round(days_remaining / 7, 4)


def days_remaining(expires_at: str, now: datetime | None = None) -> int:
    """Whole days between now and an ISO-8601 expiry timestamp (floor)."""
    now = now or datetime.now(timezone.utc)
    expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    delta = expiry - now
    return int(delta.total_seconds() // 86400)


def build_consent_status(
    source: str, fi_type: str, expires_at: str, now: datetime | None = None
) -> ConsentSourceStatus:
    d = days_remaining(expires_at, now)
    return ConsentSourceStatus(
        source=source,
        fi_type=fi_type,
        expires_at=expires_at,
        days_remaining=d,
        confidence_multiplier=confidence_multiplier(d),
    )


def apply_decay(
    model_confidence: float, consent_statuses: list[ConsentSourceStatus]
) -> tuple[float, ConsentSourceStatus | None]:
    """Returns (final_confidence, weakest_source_status)."""
    if not consent_statuses:
        return round(model_confidence, 4), None
    weakest = min(consent_statuses, key=lambda s: s.confidence_multiplier)
    final = round(model_confidence * weakest.confidence_multiplier, 4)
    return final, weakest
