# TrueLedger

Agentic credit underwriting by **The Outliers**, for the Google Cloud AI
Builder Cup 2026 (APAC) - BFSI track. The audit trail is the product, not a
feature bolted on.

An agentic credit-underwriting system built against India's Account
Aggregator (AA) data model. A borrower's financial data - bank, GST/tax,
mutual funds, insurance - is routed to its own specialist ADK agent; an
orchestrator agent then cross-checks those findings against each other for
**contradictions** (e.g. steady bank income vs. declining GST revenue),
applies **consent-expiry confidence decay**, and produces a decision with a
full, replayable **explainability ledger** - a citation for every data
point that fed it, not just a score.

> **Disclosure:** this project uses no real Account Aggregator, Sahamati,
> or FIP integration anywhere. It is built against the real AA/Setu data
> model, seeded with synthetic, representative data - real AA sandbox
> access requires RBI/SEBI/IRDAI/PFRDA regulatory status a hackathon team
> cannot obtain on this timeline. See `docs/DATA_SCHEMA.md` for the full
> reasoning.

See `docs/ARCHITECTURE.md` for the full architecture map, the JAPAC
reframe, and the roadmap; `docs/DATA_SCHEMA.md` for the data contracts,
the contradiction-rule table, and the consent-decay formula;
`docs/NON_GOALS.md` for what this project deliberately does not build;
`docs/DEPLOYMENT.md` for the step-by-step GCP setup and Cloud Run
deployment runbook.

## Repo structure

```
agents/            ADK agents: bank, gst, investment specialists + orchestrator
backend/           Cloud Run API service wrapping the agent pipeline (FastAPI)
frontend/          Cloud Run UI service: borrower list, decision view, replay stepper
data/synthetic/    Planted demo borrowers + generator, AA/Setu-schema-accurate
infra/             Dockerfiles (backend/, frontend/), deploy scripts, Firestore seed/rules
docs/              Architecture, data schema, API contract, task split, non-goals
tests/             Unit tests for the deterministic core (tools, rules, consent decay)
```

## Local development

Requires Python 3.11+ and Node 22+.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Generate + self-verify the three planted demo borrowers:
python -m data.synthetic.generate

# Run the deterministic-logic test suite (no GCP credentials needed):
PYTHONPATH=. pytest tests/ -q
```

### Running the backend locally

The agent pipeline needs Vertex AI credentials to actually call Gemini, and
a Firestore project to read/write FI data, consent, and the ledger:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=<your-project>
export GOOGLE_CLOUD_LOCATION=asia-south1  # Cloud Run/Firestore region only
export VERTEX_AI_LOCATION=global          # Gemini call location - see agents/config.py
python -m infra.seed_firestore        # seeds b_clean, b_contradiction, b_stale_consent

PYTHONPATH=. uvicorn backend.main:app --reload --port 8081
```

### Running the frontend locally

```bash
cd frontend
npm install
BACKEND_URL=http://localhost:8081 PORT=8080 node server.js
```

Then open `http://localhost:8080`, pick a borrower, and click Evaluate.

## Deploying to Cloud Run

```bash
export GOOGLE_CLOUD_PROJECT=<your-project>
./infra/deploy_backend.sh
BACKEND_URL=$(gcloud run services describe trueledger-backend --region asia-south1 --format 'value(status.url)') \
  ./infra/deploy_frontend.sh
```

## Status

Phase 1 (architecture and setup) scaffold: agent pipeline, backend API,
replay-UI frontend, synthetic data, and deploy scripts are all in place and
individually verified (pipeline construction, backend routes, frontend
serving, and the deterministic rule/consent-decay logic all have passing
tests/smoke checks). **Not yet verified end-to-end against live Vertex AI +
Firestore** - that requires GCP credentials this environment didn't have.
See `docs/ARCHITECTURE.md` for the one flagged open item (exact Gemini
model ID strings) to confirm before Phase 2.
