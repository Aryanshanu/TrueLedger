"""Central configuration for the underwriting agent pipeline.

Every value here is overridable via environment variable so the same code
runs locally (Firestore emulator, no Vertex AI creds) and on Cloud Run.
"""

import os

# --- Google Cloud / Vertex AI ---
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
GOOGLE_CLOUD_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "asia-south1")
GOOGLE_GENAI_USE_VERTEXAI = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")

# --- Gemini model IDs ---
# FLAGGED, NOT SILENTLY ASSUMED: the build brief names the intended tiers as
# "Gemini 3.8 Flash" (specialist sub-agents) and "Gemini 3.1 Pro"
# (orchestrator's reasoning pass), but explicitly says the exact Vertex AI
# model ID string must be confirmed against the live model list at build
# time, since marketing names and API IDs can diverge. This sandbox has no
# Vertex AI credentials to check that list, so the strings below are a
# best-guess placeholder derived from the marketing names, not a verified
# API ID. Before Phase 2, confirm with:
#   gcloud ai models list --region=$GOOGLE_CLOUD_LOCATION
# (or the Vertex AI Model Garden UI) and correct these two env vars/defaults
# if they don't match the live ID.
SPECIALIST_MODEL = os.environ.get("SPECIALIST_MODEL", "gemini-3.8-flash")
ORCHESTRATOR_MODEL = os.environ.get("ORCHESTRATOR_MODEL", "gemini-3.1-pro")

# --- Firestore collections ---
# Layout:
#   fi_data/{borrower_id}/sources/{DEPOSIT|GSTR1_3B|MUTUAL_FUNDS|INSURANCE_POLICIES}
#   consent/{borrower_id}/sources/{fi_type}            -> {expires_at, ...}
#   claims/{borrower_id}/agents/{bank|gst|investment}  -> last AgentFindings
#   ledger/{step_id}                                   -> append-only LedgerEntry
#   decisions/{borrower_id}                             -> latest Decision
FIRESTORE_FI_DATA_COLLECTION = "fi_data"
FIRESTORE_CONSENT_COLLECTION = "consent"
FIRESTORE_CLAIMS_COLLECTION = "claims"
FIRESTORE_LEDGER_COLLECTION = "ledger"
FIRESTORE_DECISIONS_COLLECTION = "decisions"

# --- Rule thresholds (see docs/DATA_SCHEMA.md for the full rule table) ---
TREND_STABLE_BAND_PCT = 7.0  # |pct change| below this => "stable"
DECLARED_VS_ACTUAL_GAP_PCT = 15.0
INSURANCE_COVERAGE_MIN_RATIO = 0.5  # coverage below 50% of loan => risk flag

APP_NAME = "trueledger"
