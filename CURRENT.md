# CURRENT.md - Codebase Status, Production Architecture & Verification

## Current System State
- **Branch**: `main`
- **Application Status**: Production-ready. Synchronized dual-tier architecture:
  - React/TypeScript Reference: `frontend/components/TrueLedgerEnterpriseApp.tsx`
  - Live Browser Runtime: `frontend/public/app.js`, `frontend/public/desk.html`, `frontend/public/style.css`, `frontend/server.js`
- **Backend Status**: FastAPI service in `backend/main.py`. Test suite passes completely (**41/41 tests passing**).
- **Frontend Status**: Express server on port `8080` serving the Customer Progressive Disclosure Wizard and the isolated `/app/dev-login` route.

---

## Architecture Alignment

### 1. Customer Progressive Disclosure Flow
- **Step 1 (Login)**: Branded institutional shell (`bg-[#060913]`) with email/password and "⚡ Demokit Simulation Login".
- **Step 2 (Onboarding)**: Business entity configuration (`Acme Hyperion Logistics Corp`) + 3 mandatory channel gates (GSTN GSTR-1/3B, ITR 16/26AS, Bank MFT feed).
- **Step 3 (Telemetry)**: Multi-agent swarm monitoring panel (0% → 100% progress animation with live trace ticker updates across Bank, GST, and Tax specialist agents).
- **Step 4 (Verdict Dossier)**: Permanent Decision Anchor Bar, Asymmetric Discrepancy Card (₹1.42 Cr / 27.2% revenue gap), bidirectional ledger deep-links, and working CSV & PDF export triggers.

### 2. Isolated Developer Governance Flow
- **Endpoint**: `/app/dev-login` (Express HTTP 302 redirect to `#view=dev_auth`).
- **Hidden Access**: `#dev-login`, `Ctrl+Shift+D`, or double-clicking the version tag (`v2.4.0-prod`).
- **Security**: Validates against `admin` / `TrueLedger2026!`. Zero exposure in customer DOM, navigation, or command palette.
- **Append-Only Governance**: Immutable audit log stream tracking all customer transitions and export events with SHA-256 block hashes.

---

## Standard Execution Commands

### Run Deterministic Unit Tests
```powershell
.\.venv\Scripts\python.exe -m pytest tests/ -v
```

### Run FastAPI Backend (Port 8081)
```powershell
$env:PYTHONPATH="."
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8081
```

### Run Frontend Static / Express Server (Port 8080)
```powershell
$env:BACKEND_URL="http://127.0.0.1:8081"
$env:PORT="8080"
node frontend/server.js
```

---

## Active Verification
- `http://localhost:8080/desk` → HTTP 200 (Customer wizard)
- `http://localhost:8080/app/dev-login` → HTTP 302 (Redirects to `#view=dev_auth`)
- `http://localhost:8081/health` → `{"status": "ok"}`
- Test Suite: 41 passed in 3.76s.
