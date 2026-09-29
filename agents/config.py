"""Central configuration for the underwriting agent pipeline.

Every value here is overridable via environment variable so the same code
runs locally (Firestore emulator, no Vertex AI creds) and on Cloud Run.
"""

import os

# --- Google Cloud project / Cloud Run region ---
# GOOGLE_CLOUD_PROJECT is used both by the Firestore client and (as a
# fallback) by the Gemini client below. GOOGLE_CLOUD_LOCATION is the Cloud
# Run / Artifact Registry deploy region only (see infra/deploy_*.sh) - it is
# NOT the Vertex AI call location; see VERTEX_AI_LOCATION for that.
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
GOOGLE_CLOUD_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "asia-south1")

# --- Vertex AI ("Gemini Enterprise Agent Platform") call location ---
# Confirmed against the live model docs (Sept 2026), not guessed: Google's
# own sample code for gemini-3.8-flash uses `location="global"`, and the
# curl sample's endpoint host drops the region prefix entirely
# (`aiplatform.googleapis.com`, not `asia-south1-aiplatform.googleapis.com`)
# specifically for the global location. ADK's own Gemini model wrapper
# documents the identical pattern (`client_kwargs={"enterprise": True,
# "location": "global"}`). So this is deliberately decoupled from
# GOOGLE_CLOUD_LOCATION above (asia-south1 is still right for Cloud
# Run/Firestore; it is not necessarily where every Gemini tier is served).
# Each agent passes this explicitly via `client_kwargs`, not via an
# environment variable the SDK reads implicitly - see agents/bank_agent.py
# etc. Note also: as of google-genai 2.25.0, the enterprise/Vertex client
# reads `GOOGLE_GENAI_USE_ENTERPRISE` (its own docstring never mentions the
# older `GOOGLE_GENAI_USE_VERTEXAI` name from earlier SDK versions), which
# is exactly why this is now passed explicitly per agent instead of relying
# on an environment variable whose name could drift again.
VERTEX_AI_LOCATION = os.environ.get("VERTEX_AI_LOCATION", "global")

# --- Gemini model IDs ---
# SPECIALIST_MODEL: CONFIRMED against the live Vertex AI Model Garden page
# for Gemini 3.8 Flash (Sept 2026) - "Model name: gemini-3.8-flash" is the
# documented Resource ID, matching what was already a placeholder here.
#
# ORCHESTRATOR_MODEL: STILL FLAGGED, NOT YET CONFIRMED. "gemini-3.1-pro" is
# still only the best-guess placeholder derived from the "Gemini 3.1 Pro"
# marketing name in the build brief - check its Model Garden page the same
# way (Resource ID under "Model details") before relying on it.
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


def build_specialist_model():
    """A Gemini model object pinned to VERTEX_AI_LOCATION, for the three
    specialist sub-agents. See the VERTEX_AI_LOCATION comment above for why
    this is passed explicitly via client_kwargs rather than left to an
    environment variable the SDK might read differently.
    """
    from google.adk.models import Gemini

    return Gemini(model=SPECIALIST_MODEL, client_kwargs={"enterprise": True, "location": VERTEX_AI_LOCATION})


def build_orchestrator_model():
    """Same as build_specialist_model, for the orchestrator's own model tier."""
    from google.adk.models import Gemini

    return Gemini(model=ORCHESTRATOR_MODEL, client_kwargs={"enterprise": True, "location": VERTEX_AI_LOCATION})
