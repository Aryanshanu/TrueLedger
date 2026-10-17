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

## Project phase status

**Phases 1, 2, and 3 complete.**

| Phase | Dates | Status |
|---|---|---|
| 1. Architecture & setup | Sep 27 – Oct 2 | Complete |
| 2. Core agent build | Oct 3 – Oct 10 | Complete |
| 3. Integration & deploy | Oct 11 – Oct 14 | Complete |
| 4. Demo, polish, submit | Oct 15 – Oct 17 | **In progress** |

### Borrower benchmark suite (8 cases, all recorded)

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
Both Cloud Run services deployed to `asia-south1` with `min-instances=1`.

---

## Frontend UI architecture (current state as of Oct 15)

### 4-step progressive wizard

```
Step 1: Sign In
    └─► Step 2: Entity Intake + Benchmark Select
              └─► [proceedBtn] builds activeSession snapshot
                       └─► Step 3: Cross-Verification Telemetry
                                └─► Step 4: Credit Assessment Dossier
                                         └─► [Dashboard nav] switches to workspace shell
```

### `activeSession` state contract

Built at Step 2 on `proceedBtn` click. This is the canonical identity snapshot that bridges the wizard into all workspaces.

```js
activeSession = {
  entityName, pan, gstin, loanAmount,
  industry,   // derived from BENCHMARK_CASES sector → industry label
  state,      // derived from GSTIN 2-digit prefix via GSTIN_STATE map
  files,      // array of uploaded file objects
  benchmark,  // selected benchmark case ID
  timestamp
}
```

`buildActiveEntity(baseEntity)` overlays `activeSession` identity fields over `enterpriseData.entity` so all workspaces render the correct entity, not the static reference entity.

### 5 workspace shell + sub-view matrix

| Workspace key | Sub-views | Default view |
|---|---|---|
| `dashboard` | (single view) | — |
| `client` | `onboarding`, `kyb`, `vault` | `onboarding` |
| `income` | `invoices`, `tds`, `cashflows` | `invoices` |
| `compliance` | `gst-lifecycle`, `itc` | `gst-lifecycle` |
| `assets` | `mf-portfolios`, `capital` | `mf-portfolios` |

Sub-view state persists in `wsActiveViews` (object keyed by workspace). Switching workspaces restores the last viewed sub-view.

### Dashboard action button routing

Each "Initiate →" button navigates to the relevant workspace + sub-view:

| Action ID | Route |
|---|---|
| `file_gstr3b_jul26` | compliance / gst-lifecycle |
| `reconcile_gstr2b_aug26` | compliance / itc |
| `tds_sync_q2` | income / tds |
| `file_gstr1_sep26` | compliance / gst-lifecycle |

---

## Phase 4 open items (Oct 15–17)

1. **Demo video** — show the wizard flow end-to-end with a contradiction case, highlight the ledger's bidirectional evidence jump, and show the multi-agent swarm telemetry. Narrate that AA is the only implemented adapter but the engine is adapter-agnostic.
2. **PPT → PDF** — deck covering problem, solution, architecture, benchmark results, roadmap. Submit a day early (Oct 16).
3. **Repo cleanup** — remove any remaining stale prototype artifacts, verify README accuracy.
4. **Submission checklist** — confirm public repo visibility, live Cloud Run URLs, video URL, PDF, team details.

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
- **Orchestrator always writes** `flag_contradiction` per contradiction found (rules.py → orchestrator_agent.py lines 110–119) and `apply_consent_decay` unconditionally.
- **Evidence chips in the ledger** for a `flag_contradiction` entry have `data-jump-source` / `data-jump-field` pointing to the specialist claim that sourced the signal.
- **Recorded captures** are verbatim API response snapshots (`capturedAt` field). `isAuditDossier: true` + "Audited Dossier" badge makes this explicit in the UI.
- **No real AA/Sahamati integration** anywhere. Synthetic data follows the real AA/Setu FI schema.
- **`buildActiveEntity(baseEntity)`** must be called at the top of every workspace render function. It overlays `activeSession` onto the static reference JSON so the correct entity is shown regardless of which benchmark case was selected.
- **`wsActiveViews`** is module-level, persists across workspace switches. Each sub-nav click handler sets `wsActiveViews[activeWorkspace] = view` then calls `renderWorkspaceMain(activeWorkspace)`.
- **Customer login** (`customer-login-form`) accepts any valid email format — `performLogin()` runs unconditionally. Dev portal login (`dev-username-input` / `dev-password-input`) requires admin credentials (not stored in docs).
- **GSTIN state derivation** — `GSTIN_STATE` maps 2-digit prefix to Indian state name. Deccan Cements GSTIN `37AADCD7891K1Z9` → prefix `37` → Andhra Pradesh.
