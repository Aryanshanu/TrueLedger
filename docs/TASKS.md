# Task split (2-person team)

A starting split by architecture layer, not by name - the team can swap
based on who's stronger where. Both phases still gate on the shared
Definition of Done in `docs/DATA_SCHEMA.md`.

## Track A: Agents + data
- Verify `SPECIALIST_MODEL` / `ORCHESTRATOR_MODEL` against the live Vertex
  AI model list (`docs/ARCHITECTURE.md`, "Flagged: exact Gemini model IDs")
  and update `agents/config.py`.
- Wire real Vertex AI credentials locally, run `python -m infra.seed_firestore`
  against a real Firestore project, and get `POST /borrowers/b_contradiction/evaluate`
  producing a real (non-mocked) decision end to end.
- Tune the three specialist prompts (`agents/bank_agent.py`,
  `agents/gst_agent.py`, `agents/investment_agent.py`) once real model
  output is visible - the citation discipline in each instruction is the
  part most likely to need iteration.
- Extend `agents/rules.py` / `tests/test_rules.py` if real model behavior
  surfaces additional cases worth hard-coding as rules rather than leaving
  to the subtler-reasoning LLM pass.

## Track B: Backend + frontend + infra
- Stand up the Firestore project (native mode, `asia-south1`), enable
  required APIs (Vertex AI, Cloud Run, Artifact Registry, Cloud Build).
- Get `infra/deploy_backend.sh` and `infra/deploy_frontend.sh` running
  against that project - the Phase 1 gate is "empty skeleton deployed and
  reachable" on a public Cloud Run URL, not just running locally.
- Build out the replay UI beyond the Phase 1 skeleton
  (`frontend/public/app.js`) once real ledger data exists - the
  click-through from a flagged contradiction to the exact transaction/
  filing-period evidence (already wired for the synthetic shape) is the
  single UI interaction most worth polishing first.
- Own the explainability-ledger -> replay-UI plumbing end to end
  (`GET /borrowers/{id}/ledger`), since that's the pitch made visible.

## Both
- Phase 4 (Oct 15-17): demo video (before/after contrast - "5 days by a
  human underwriter" vs. "8 seconds plus a full contradiction trail"),
  documentation (PPT -> PDF), repo cleanup, final submission checklist.
- Keep `docs/NON_GOALS.md` in view during the core build - it's short on
  purpose.
