#!/usr/bin/env bash
# Captures real /evaluate + /ledger + /consent-status responses for all 8
# demo borrowers (3 core + 5 edge cases) against the deployed backend, and
# writes them to ./recorded/<id>.{evaluate,ledger,consent}.json.
#
# Run scripts/seed_cases.py first, in the same sitting (see its docstring
# for why the gap matters for b_closing_consent/b_double_flag's consent
# timing). Usage:
#
#   BASE=https://trueledger-backend-xyz.run.app ./scripts/capture_recorded.sh
#
# Or let it discover the backend URL itself via gcloud:
#
#   ./scripts/capture_recorded.sh
#
# The POST body matches exactly what the real frontend (app.js's
# loadBorrower()) sends: no body, just Content-Length: 0 - the backend's
# evaluate() endpoint takes no request body.
set -euo pipefail

BASE="${BASE:-$(gcloud run services describe trueledger-backend --region "${GOOGLE_CLOUD_LOCATION:-asia-south1}" --format 'value(status.url)')}"
echo "Using backend: $BASE"

mkdir -p recorded

CASES="b_clean b_contradiction b_stale_consent b_freelancer b_roundtrip b_closing_consent b_seasonal b_double_flag"

for id in $CASES; do
  echo "Running $id (can take 10-30s)..."
  curl -sS --max-time 120 -X POST "$BASE/borrowers/$id/evaluate" -H 'content-length: 0' -o "recorded/$id.evaluate.json"
  curl -sS "$BASE/borrowers/$id/ledger"         -o "recorded/$id.ledger.json"
  curl -sS "$BASE/borrowers/$id/consent-status" -o "recorded/$id.consent.json"
done

echo "---- file sizes (none should be 0) ----"
wc -c recorded/*.json
