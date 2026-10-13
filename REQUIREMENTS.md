# REQUIREMENTS.md - TrueLedger Project Specifications & Constraints

## 1. Overview & Architecture
- **Event**: Google Cloud AI Builder Cup 2026 (APAC), BFSI Track.
- **Team**: The Outliers.
- **Topology**:
  - Frontend: Cloud Run (Node.js/Express static file host serving `/desk` and `/`).
  - Backend: Cloud Run (FastAPI, Python 3.13) wrapping ADK Agent pipeline.
  - Specialists (ParallelAgent):
    - `bank_statement_agent` (Gemini 3.8 Flash, Vertex AI global)
    - `gst_tax_agent` (Gemini 3.8 Flash, Vertex AI global)
    - `investment_agent` (Gemini 3.8 Flash, Vertex AI global)
  - Orchestrator (BaseAgent / OrchestratorAgent):
    - `rules.py` (Deterministic contradiction matrix)
    - Subtler reasoning LlmAgent (Gemini 3.1 Pro preview, Vertex AI global)
    - `consent.py` (Linear expiry decay formula)
    - `ledger.py` (Append-only audit trail -> Firestore)
  - Database: Google Cloud Firestore in `asia-south1` (`fi_data`, `consent`, `claims`, `ledger`, `decisions`).

## 2. Invariants & Rules
1. **Append-Only Ledger**: `ledger.py:write_entry` must NEVER overwrite or delete existing steps. Deduplication occurs in client views (`app.js:dedupLedgerSteps()`).
2. **Deterministic Precedence**: Rules in `rules.py` trigger first. If a deterministic contradiction triggers, it takes precedence.
3. **Consent Decay Formula**:
   $$c(d) = \begin{cases} 1.0 & \text{if } d > 7 \\ d / 7.0 & \text{if } 0 < d \le 7 \\ 0.0 & \text{if } d \le 0 \end{cases}$$
4. **Honesty & Explainability**: Every flagged contradiction in the ledger must include traceable evidence (`data-jump-source` / `data-jump-field`) pointing to transaction or filing period IDs.
5. **Synthetic & Live Dual Support**: The system must run flawlessly offline with recorded JSON fixtures (`frontend/public/recorded/`) while supporting live Vertex AI re-evaluations when GCP credentials exist.
