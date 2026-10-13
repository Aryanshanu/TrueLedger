# PLAN.md - Implementation & Architecture Roadmap

## Milestone 1: Stack Bootstrap & Server Liveness
- [x] Spin up the backend server on `127.0.0.1:8081` and verify `/health` responds with `{"status": "ok"}`.
- [x] Spin up the frontend server on `127.0.0.1:8080` and verify `/config.js`, `/desk`, and static assets load with HTTP 200.

## Milestone 2: Frontend & API Connectivity Verification
- [x] Validate `/borrowers/{id}/ledger` and recorded fixtures fallback in `frontend/public/app.js`.
- [x] Test client-side UI error handling and mock ingestion of `enterprise_live_state.json`.

## Milestone 3: Progressive Disclosure State Router & Developer Gate
- [x] Rebuild state router to enforce strict 4-step progressive disclosure (Step 1 Login → Step 2 Onboarding 3-channel gate → Step 3 Telemetry swarm 0-100% → Step 4 Final Dossier).
- [x] Implement isolated developer gateway route `/app/dev-login` with credential gate (`admin` / `TrueLedger2026!`).
- [x] Sanitize customer DOM: completely remove all dev consoles and login buttons from customer menus, footers, and command palette.
- [x] Build append-only governance log tracking all customer actions with SHA-256 block digests.
- [x] Mirror architecture in both TypeScript/Next.js reference component (`frontend/components/TrueLedgerEnterpriseApp.tsx`) and live runtime (`frontend/public/app.js`, `desk.html`, `style.css`).

## Milestone 4: Final Verification & Repository Hygiene
- [x] Re-run the full test suite (`pytest tests/ -v`) — 41/41 passing.
- [x] Update `.gitignore` to prevent scratch logs and local temporary files from being tracked.
- [x] Rewrite `README.md` to institutional production standard with architecture diagrams, 60/40 split, and benchmark matrix.
- [x] Stage, commit, and push clean code to GitHub repository.
