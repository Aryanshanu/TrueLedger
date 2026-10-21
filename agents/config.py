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
# SPECIALIST_MODEL: CONFIRMED directly against the live Vertex AI Model
# Garden console page for Gemini 3.8 Flash (Sept 2026, read and pasted back
# by the team) - "Model name: gemini-3.8-flash" is the documented Resource
# ID, matching what was already a placeholder here.
#
# ORCHESTRATOR_MODEL: CONFIRMED via web search cross-referenced across the
# official Vertex AI docs, Google's own blog post, and multiple developer
# forum threads (Sept 2026) - NOT eyeballed directly against the console
# the way SPECIALIST_MODEL was, since this sandbox's network proxy blocks
# docs.cloud.google.com/ai.google.dev/deepmind.google outright. Do one
# quick personal check in Model Garden to be certain, the same way you did
# for Flash. Two things this correction changed:
#   1. The Resource ID carries a "-preview" suffix: "gemini-3.1-pro-preview",
#      not the bare "gemini-3.1-pro" this was previously guessed as.
#   2. This preview model is GLOBAL-ENDPOINT-ONLY - not just "available at"
#      VERTEX_AI_LOCATION="global" by our choice, but with no regional
#      endpoint offered at all (confirmed by a forum thread of people
#      explicitly asking for regional/data-residency access and being told
#      it isn't available for this preview version). Firestore/Cloud Run
#      correctly stay in asia-south1; be ready to explain in the demo/docs
#      that the orchestrator's Gemini call itself necessarily goes through
#      Google's global endpoint, since that's this preview model's only
#      option, not a regional trade-off we chose.
SPECIALIST_MODEL = os.environ.get("SPECIALIST_MODEL", "gemini-3.8-flash")
ORCHESTRATOR_MODEL = os.environ.get("ORCHESTRATOR_MODEL", "gemini-3.1-pro-preview")

# --- Gemini call resilience ---
# Every evaluation makes 4 Gemini calls (3 specialist agents + the
# orchestrator's inner subtler-reasoning pass), each previously with zero
# retry - a single transient 429/503 from Vertex AI failed the whole
# evaluation. google-genai 2.25.0 (pinned in requirements.txt) and
# google-adk 2.10.0's Gemini model wrapper both take a native
# `HttpRetryOptions` (ADK's own docstring at
# google/adk/models/google_llm.py:189 documents passing it as
# `Gemini(retry_options=...)` directly - confirmed against the installed
# package, not guessed), so this uses the SDK's built-in retry rather than
# a hand-rolled wrapper. Exponential backoff, capped attempts so a
# genuinely-down endpoint still fails instead of hanging the request.
GEMINI_RETRY_ATTEMPTS = int(os.environ.get("GEMINI_RETRY_ATTEMPTS", "4"))
GEMINI_RETRY_INITIAL_DELAY_SECONDS = float(os.environ.get("GEMINI_RETRY_INITIAL_DELAY_SECONDS", "1.0"))
GEMINI_RETRY_MAX_DELAY_SECONDS = float(os.environ.get("GEMINI_RETRY_MAX_DELAY_SECONDS", "20.0"))

# --- Gemini concurrency cap ---
# RateLimitMiddleware (backend/main.py) is per-process, per-client-IP - it
# does nothing to cap TOTAL concurrent Gemini calls across every client at
# once (a burst of requests from many different IPs, e.g. several judges
# testing simultaneously, or a single bot spread across IPs, sails
# straight through it). This is the "real concurrency cap on Gemini calls
# (a semaphore in the pipeline runner, not just the per-instance rate
# limiter)" the PDR asked for - a single process-wide asyncio.Semaphore
# shared by every path that calls Gemini (backend/runner.py's full
# pipeline evaluations, agents/extraction.py's document extraction),
# bounding how many of either can be in flight at once regardless of how
# many distinct clients triggered them.
GEMINI_MAX_CONCURRENCY = int(os.environ.get("GEMINI_MAX_CONCURRENCY", "5"))

_gemini_semaphore = None


def get_gemini_semaphore():
    """Lazily creates the shared semaphore on first use, inside whatever
    event loop is actually running - creating an asyncio.Semaphore at
    import time would bind it to no loop (or the wrong one, under a test
    runner that creates a fresh loop per test)."""
    global _gemini_semaphore
    import asyncio

    if _gemini_semaphore is None:
        _gemini_semaphore = asyncio.Semaphore(GEMINI_MAX_CONCURRENCY)
    return _gemini_semaphore

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

# --- Backend auth ---
# Both Cloud Run services deploy with --allow-unauthenticated (see
# infra/deploy_*.sh) - intentional, since neither has real user accounts
# yet, but it also means anyone on the internet can hit the Gemini-calling
# endpoints directly, not just through the frontend. API_KEY is a shared
# key, not real per-user auth (there are no user accounts to attach it to)
# - it exists to raise the cost of anonymous bot/scanner traffic hitting
# POST /borrowers/upload or /evaluate and running up a Gemini bill, not to
# keep out a motivated person (the frontend ships the key to the browser
# via /config.js - see frontend/server.js - so it's visible in dev tools
# the same way BACKEND_URL already is). Empty string (the default) means
# auth is disabled entirely, so local dev and a demo deploy with no key
# configured both keep working exactly as before this was added.
API_KEY = os.environ.get("API_KEY", "")

# --- Logging ---
# Previously nothing in this codebase configured Python's logging module at
# all, so a production failure (Gemini error, Firestore error, a borrower
# with no decision) was only visible as whatever FastAPI's default
# exception path happened to print - a raw traceback, with no request
# context, and nothing at all for an error that was already caught and
# turned into a clean 4xx (the client sees why; the server logs don't).
# This is deliberately plain `logging` to stdout, not the
# `google-cloud-logging` client library: Cloud Run's log driver captures
# container stdout/stderr and Cloud Logging's severity parser already
# recognizes the standard `LEVELNAME` text this format produces, so a
# second GCP-specific client/dependency isn't needed just to get leveled,
# attributable log lines.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")


def configure_logging() -> None:
    import logging

    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL.upper(), 20),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _gemini_retry_options():
    from google.genai import types

    return types.HttpRetryOptions(
        attempts=GEMINI_RETRY_ATTEMPTS,
        initial_delay=GEMINI_RETRY_INITIAL_DELAY_SECONDS,
        max_delay=GEMINI_RETRY_MAX_DELAY_SECONDS,
    )


def build_specialist_model():
    """A Gemini model object pinned to VERTEX_AI_LOCATION, for the three
    specialist sub-agents. See the VERTEX_AI_LOCATION comment above for why
    this is passed explicitly via client_kwargs rather than left to an
    environment variable the SDK might read differently.
    """
    from google.adk.models import Gemini

    return Gemini(
        model=SPECIALIST_MODEL,
        client_kwargs={"enterprise": True, "location": VERTEX_AI_LOCATION},
        retry_options=_gemini_retry_options(),
    )


def build_orchestrator_model():
    """Same as build_specialist_model, for the orchestrator's own model tier."""
    from google.adk.models import Gemini

    return Gemini(
        model=ORCHESTRATOR_MODEL,
        client_kwargs={"enterprise": True, "location": VERTEX_AI_LOCATION},
        retry_options=_gemini_retry_options(),
    )
