"""Seeds Firestore with the three planted demo borrowers.

Requires GOOGLE_CLOUD_PROJECT and application-default credentials
(`gcloud auth application-default login`). Run from the repo root:

    python -m infra.seed_firestore

Consent `expires_at` timestamps are computed relative to the moment this
script runs (see data/synthetic/borrowers.py), so re-running it right
before a demo keeps "2 days left" accurate.
"""

from __future__ import annotations

from agents.firestore_gateway import set_consent, set_fi_data
from data.synthetic.borrowers import ALL_BORROWERS


def main() -> None:
    for borrower_id, builder in ALL_BORROWERS.items():
        data = builder()
        consent = data.pop("consent")
        set_fi_data(borrower_id, data)
        set_consent(borrower_id, consent)
        print(f"Seeded {borrower_id}")


if __name__ == "__main__":
    main()
