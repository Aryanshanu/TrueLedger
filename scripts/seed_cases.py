"""Seeds Firestore with all 8 demo borrowers (3 core + 5 edge cases).

Idempotent - re-running overwrites each borrower's fi_data/consent with the
same deterministic values (plus freshly-computed `expires_at` timestamps),
never creates duplicates. Requires GOOGLE_CLOUD_PROJECT and
application-default credentials (`gcloud auth application-default login`).
Run from the repo root:

    python -m scripts.seed_cases

This is a thin wrapper around infra/seed_firestore.py, which already seeds
every borrower in data.synthetic.borrowers.ALL_BORROWERS generically - that
dict now has 8 entries instead of 3, so the existing script already covers
the 5 new cases with no changes of its own needed. This wrapper exists
only because the brief asked for scripts/seed_cases.py by that exact path;
it does not duplicate any seeding logic.

IMPORTANT - consent timing: b_closing_consent and b_double_flag are seeded
with a bank consent a few days from expiry, to land inside the 0<d<=7
linear decay zone (not yet expired, but not full-strength either). That
window is computed relative to the moment THIS script runs. Run this
script and scripts/capture_recorded.sh back-to-back, in the same sitting -
the longer the gap between seeding and capturing, the more "closing in ~3
days" drifts toward (or past) fully expired by the time you actually
capture it. (This already happened once: b_stale_consent was seeded at 2
days left, but had drifted to -3 days - already expired - by the time it
was captured for the recorded JSON files.)
"""

from __future__ import annotations

from infra.seed_firestore import main

if __name__ == "__main__":
    main()
