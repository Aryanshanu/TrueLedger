# TrueLedger — Session Context

Google Cloud AI Builder Cup 2026 (APAC), BFSI track.  
Team: **The Outliers**. Two-person build; Claude Code is the execution partner.

---

## Architecture (brief)

```
Frontend (Cloud Run, Express/static)
    └─► Backend (Cloud Run, FastAPI)
            └─► ADK ParallelAgent
                    ├─ bank_statement_agent   (Gemini Flash, Vertex AI global)
                    ├─ gst_tax_agent          (Gemini Flash, Vertex AI global)
                    └─ investment_agent       (Gemini Flash, Vertex AI global)
            └─► OrchestratorAgent (BaseAgent)
                    ├─ rules.py   (deterministic contradiction table)
                    ├─ subtler-reasoning LlmAgent (Gemini Pro, global)
                    ├─ consent.py (expiry decay: c(d) = 1 if d>7, d/7 if 0<d≤7, 0 if d≤0)
                    └─ ledger.py  (append-only explainability trail → Firestore)
Firestore: fi_data / consent / claims / ledger / decisions
```

**Model IDs (confirmed)**
- `SPECIALIST_MODEL = "gemini-3.8-flash"` — Vertex AI, `location="global"`
- `ORCHESTRATOR_MODEL = "gemini-3.1-pro-preview"` — global endpoint only (no regional option)

**GCP region:** `asia-south1` for Cloud Run + Firestore; Gemini calls use `location="global"`.

---

## Repo layout

```
agents/         ADK agents: bank, gst, investment specialists + orchestrator
backend/        FastAPI API (main.py, runner.py)
frontend/       Express static server + public/ (desk.html, app.js, style.css)
data/synthetic/ 8 demo borrowers (borrowers.py, generate.py)
infra/          seed_firestore.py, deploy scripts, Firestore rules
scripts/        seed_cases.py (seeds all 8), capture_recorded.sh
docs/           ARCHITECTURE.md, DATA_SCHEMA.md, API.md, TASKS.md, NON_GOALS.md
tests/          pytest suite for deterministic core (no GCP needed)
```

---

## Current project state

**Phases 1 & 2 complete** (gate was Oct 10).

| Borrower | Outcome | Confidence | Key signal |
|---|---|---|---|
| `b_clean` | approve | 0.95 | No contradictions, fresh consent |
| `b_contradiction` | manual_review | 0.50 | `income_vs_revenue_divergence` (+2.1% bank vs −11% GST) |
| `b_stale_consent` | decline | 0.00 | Expired bank consent → decay → 0 |
| `b_freelancer` | (recorded) | — | Thin file, regular SIP cushion |
| `b_roundtrip` | (recorded) | — | Deposit surges vs flat GST |
| `b_closing_consent` | (recorded) | — | 2d consent remaining → decay |
| `b_seasonal` | (recorded) | — | Cyclical seasonal dip |
| `b_double_flag` | (recorded) | — | Turnover divergence + decaying consent |

All 8 have verbatim captured JSON in `frontend/public/recorded/`.  
Both Cloud Run services are deployed to `asia-south1` with `min-instances=1`.

---

## Phase 3 (Oct 11–14) — gate: full system live on a public URL

**Open items (in priority order):**

1. **Exercise the replay UI in an actual browser** — has never been manually tested against live data. The recorded captures power instant first paint; "Re-evaluate Live" triggers a real Vertex AI run.
2. **Verify the contradiction → evidence jump interaction** — clicking an evidence chip on the `flag_contradiction` ledger entry should scroll to the bank/gst agent's claim with transaction IDs. Wired in `app.js:jumpToClaim()`, untested live.
3. **Seed all 8 borrowers** before re-testing live evaluations: `python -m scripts.seed_cases` (consent timestamps are computed relative to `now`, so re-seed right before a demo).
4. **Confirm Cloud Run URL is reachable** and all 8 cases evaluate without error end-to-end.

---

## Phase 4 (Oct 15–17)

Demo video (before/after contrast: "5 days by a human underwriter" vs "8 seconds + full contradiction trail"), PPT→PDF, repo cleanup, submission checklist. Deadline: submit a day early (Oct 16).

---

## Local dev

```bash
# Python (backend + agents, no GCP needed for deterministic tests):
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. pytest tests/ -q

# Frontend (recorded captures work without any GCP creds):
cd frontend && npm install
BACKEND_URL=http://localhost:8081 PORT=8080 node server.js
# → http://localhost:8080/desk

# Full stack (needs GCP creds + seeded Firestore):
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=<project>
python -m scripts.seed_cases          # idempotent, updates consent timestamps
PYTHONPATH=. uvicorn backend.main:app --reload --port 8081
```

---

## Key invariants

- **Ledger is append-only.** `ledger.py:write_entry` never edits. `dedupLedgerSteps()` in `app.js` keeps the latest entry per `(agent, metric)` for deduplication of multi-run histories.
- **Orchestrator always writes** `flag_contradiction` per contradiction found (rules.py → orchestrator_agent.py lines 110-119) and `apply_consent_decay` unconditionally.
- **Evidence chips in the ledger** for a `flag_contradiction` entry have `data-jump-source` / `data-jump-field` pointing to the specialist claim that sourced the signal.
- **Recorded captures** are verbatim API response snapshots (`capturedAt` field). `isAuditDossier: true` + "Audited Dossier" badge makes this explicit in the UI.
- **No real AA/Sahamati integration** anywhere. Synthetic data follows the real AA/Setu FI schema.
