# Task tracking — The Outliers

Architectural split by layer. Both phases gate on the shared Definition of Done in `docs/DATA_SCHEMA.md`.

---

## Phase 1 — Architecture & Setup (Sep 27 – Oct 2) ✅ COMPLETE

- [x] Architecture decided, ADK pipeline designed
- [x] Empty Cloud Run skeleton deployed and reachable (both services)
- [x] Firestore project provisioned, native mode, `asia-south1`
- [x] Required GCP APIs enabled (Vertex AI, Cloud Run, Artifact Registry, Cloud Build)
- [x] Service account `trueledger-runner` created with correct IAM roles
- [x] `agents/config.py` — confirmed `SPECIALIST_MODEL = "gemini-3.8-flash"` and `ORCHESTRATOR_MODEL = "gemini-3.1-pro-preview"` against live Model Garden console
- [x] Vertex AI call location confirmed as `location="global"` (not `asia-south1`; see `docs/ARCHITECTURE.md`)

---

## Phase 2 — Core Agent Build (Oct 3 – Oct 10) ✅ COMPLETE

### Track A: Agents + data
- [x] Three specialist agents (`bank_agent.py`, `gst_agent.py`, `investment_agent.py`) producing real Vertex AI output
- [x] Deterministic rule table (`rules.py`) — 4 known contradiction patterns, fully tested
- [x] Orchestrator hybrid pipeline: rules first, LLM subtler-reasoning second, consent decay third
- [x] Consent decay model (`consent.py`): `c(d) = 1.0 if d>7, d/7 if 0<d≤7, 0 if d≤0`
- [x] Append-only Firestore ledger (`ledger.py`)
- [x] 8 synthetic borrower cases with AA-schema compliant data
- [x] 41/41 deterministic unit tests passing

### Track B: Backend + frontend + infra
- [x] FastAPI backend with `/borrowers/{id}/evaluate` and `/borrowers/{id}/ledger` endpoints
- [x] `b_contradiction` end-to-end: real Vertex AI decision with `income_vs_revenue_divergence` flag
- [x] `b_clean` → approve (0.95), `b_stale_consent` → decline (0.00) verified live
- [x] Phase 1 skeleton upgraded to full multi-agent pipeline
- [x] All 8 borrowers seeded and recorded JSON captures in `frontend/public/recorded/`
- [x] CI/CD triggers connected (push to `main` → rebuild + redeploy both services)

---

## Phase 3 — Integration & Deploy (Oct 11 – Oct 14) ✅ COMPLETE

### UI — Progressive wizard
- [x] 4-step progressive disclosure wizard with strict state machine
- [x] 5 sector benchmark cases with auto-fill (entity, PAN, GSTIN, loan amount)
- [x] `activeSession` state contract: built at Step 2 commit, bridges identity into all workspaces
- [x] `buildActiveEntity()` function with `GSTIN_STATE` map for state derivation
- [x] Entity header in all workspaces reflects selected benchmark, not static reference entity

### UI — Workspace shell
- [x] 5-workspace sidebar with sub-nav: dashboard, client, income, compliance, assets
- [x] `wsActiveViews` — per-workspace sub-view state persists across workspace switches
- [x] Sub-nav click handler wired: was dead (CSS only), now sets `wsActiveViews` and calls `renderWorkspaceMain()`

### UI — Sub-view implementations (all data-driven, zero placeholders)
- [x] `client / onboarding` — entity profile table
- [x] `client / kyb` — 7-point KYB verification (PAN format, GSTIN format, GSTIN↔PAN linkage, entity type, banker, CA firm, FY reference)
- [x] `client / vault` — document channel connection status (files, channel flags)
- [x] `income / invoices` — invoice pipeline table
- [x] `income / tds` — Form 26AS TDS ledger (quarter/period, matched vs unmatched KPIs)
- [x] `income / cashflows` — monthly receivables timeline derived from invoices array
- [x] `compliance / gst-lifecycle` — GST filing ledger (GSTR-1 / 3B status per period)
- [x] `compliance / itc` — ITC offset analysis (eligible, payable, offset, net liability, efficiency %)
- [x] `assets / mf-portfolios` — MF portfolio table (folio, fund, AMC, units, NAV, current value, XIRR)
- [x] `assets / capital` — Capital allocation by asset type with pledgeability badges and loan coverage ratio

### UI — Dashboard
- [x] 3-column layout: Financial Overview (KPI cards, portfolio allocation, GST trend chart), GST Compliance Tracker, Action Queue
- [x] GST Compliance Tracker header uses `entity.fy` (dynamic, not hardcoded)
- [x] "Initiate →" action buttons navigate to relevant workspace/sub-view (not toast placeholders):
  - `file_gstr3b_jul26` → compliance / gst-lifecycle
  - `reconcile_gstr2b_aug26` → compliance / itc
  - `tds_sync_q2` → income / tds
  - `file_gstr1_sep26` → compliance / gst-lifecycle
- [x] All 4 action buttons browser-verified (screenshot evidence)

### Infra
- [x] Both Cloud Run services live at `asia-south1`, `min-instances=1`
- [x] All 8 cases evaluate end-to-end without error

---

## Phase 4 — Demo, Polish, Submit (Oct 15 – Oct 17) 🔵 IN PROGRESS

**Deadline: Oct 16 (submit one day early)**

- [ ] **Demo video** — show wizard flow end-to-end with a contradiction case
  - Show the wizard flow end-to-end (b_contradiction / Deccan case)
  - Highlight the ledger's bidirectional evidence jump (contradiction card → transaction row)
  - Show the multi-agent swarm telemetry
  - Note: AA is the only implemented adapter; engine is designed to be adapter-agnostic
- [ ] **PPT → PDF** — slide deck: problem, solution, architecture, benchmark results, JAPAC roadmap
- [ ] **Repo cleanup** — verify no stale prototype artifacts, final README accuracy check
- [ ] **Submission checklist**
  - GitHub repo set to public
  - Both Cloud Run URLs reachable by a judge
  - Demo video URL included
  - PDF deck uploaded
  - Team details: The Outliers

---

## Non-goals (do not implement)

See `docs/NON_GOALS.md`. Summary:
- No real AA/Sahamati integration
- No conversational "AI CFO" chat interface
- No crypto/stablecoin rails
- No invented company names, partnerships, certifications, or statistics beyond what is in the planning docs
- No deepfake/identity-fraud detection
