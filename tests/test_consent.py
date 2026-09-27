from datetime import datetime, timedelta, timezone

from agents.consent import apply_decay, build_consent_status, confidence_multiplier, days_remaining


def test_confidence_multiplier_piecewise():
    assert confidence_multiplier(30) == 1.0
    assert confidence_multiplier(8) == 1.0
    assert confidence_multiplier(7) == 1.0
    assert confidence_multiplier(4) == round(4 / 7, 4)
    assert confidence_multiplier(1) == round(1 / 7, 4)
    assert confidence_multiplier(0) == 0.0
    assert confidence_multiplier(-3) == 0.0


def test_days_remaining_floors_to_whole_days():
    now = datetime(2026, 9, 27, tzinfo=timezone.utc)
    expires = now + timedelta(days=2, hours=1)
    assert days_remaining(expires.strftime("%Y-%m-%dT%H:%M:%SZ"), now=now) == 2


def test_apply_decay_uses_weakest_source_not_average():
    now = datetime(2026, 9, 27, tzinfo=timezone.utc)
    fresh = build_consent_status("gst_findings", "GSTR1_3B", (now + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ"), now=now)
    stale = build_consent_status("bank_findings", "DEPOSIT", (now + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"), now=now)

    final, weakest = apply_decay(model_confidence=0.9, consent_statuses=[fresh, stale])

    assert weakest.source == "bank_findings"
    assert final == round(0.9 * (2 / 7), 4)
    # A single stale source caps the decision; it is not averaged with the fresh one.
    assert final < 0.9 * 0.5
