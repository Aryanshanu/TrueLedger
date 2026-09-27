# Architecture

## The pattern

Three specialist agents feed one orchestrator. ADK agents on Cloud Run, Gemini via
Vertex AI, Firestore for data and the ledger.

```
Frontend (Cloud Run)
      |
      v
Agent backend (Cloud Run, FastAPI + ADK)
      |
      v
Specialist sub-agents (ADK ParallelAgent)
  - Bank statement agent   (Gemini, Vertex AI)  --\
  - GST/tax agent          (Gemini, Vertex AI)  ---> read/write Firestore
  - MF/insurance agent     (Gemini, Vertex AI)  --/
      |
      v
Orchestrator agent (contradiction check, consent decay)
      |
      v
Firestore: fi_data, consent, claims, ledger, decisions
      |
      v
Frontend reads decision + ledger, renders replay UI
```

The frontend (Cloud Run) triggers the agent backend (also Cloud Run, running
the ADK app). The backend fans out to three specialist sub-agents running as
an ADK `ParallelAgent` group - each is an `LlmAgent` backed by Gemini via
Vertex AI, each reads its own slice of FI-schema data from Firestore, and
each writes its findings to a distinct session-state key
(`bank_findings` / `gst_findings` / `investment_findings`). A
`SequentialAgent` then runs a custom orchestrator agent that reads all three
state keys, reasons across them for contradictions, applies the
consent-expiry confidence decay, and writes the final decision plus a full
explainability ledger back to Firestore - which the frontend reads to render
the replay UI. This follows ADK's documented
`[Parallel Workers] -> [Synthesizer Agent]` pattern
([Google Developers Blog](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/)).

See `agents/pipeline.py` for the exact wiring and a flagged note on
`SequentialAgent`'s deprecation status in ADK 2.10.0 (still functional, used
deliberately rather than the newer, less-documented `Workflow` API).

## Why the orchestrator is a custom agent, not a plain `LlmAgent`

"Orchestrator: deterministic rules first, LLM reasoning second." The
orchestrator (`agents/orchestrator_agent.py`) is a `BaseAgent` subclass, not
a single `LlmAgent`, because it's a hybrid:

1. A fixed rule table (`agents/rules.py`) evaluates the four known
   contradiction patterns deterministically - no model call, fully
   auditable.
2. An inner `LlmAgent` (`orchestrator_subtler_reasoning`) then runs a
   second pass over the same three findings for subtler contradictions the
   rule table doesn't cover.
3. Consent-expiry confidence decay (`agents/consent.py`) is applied.
4. The outcome is decided and everything is written to the explainability
   ledger and the final decision document.

This split keeps the highest-stakes checks (the ones a judge or a
regulator would ask "how did it decide that?" about) outside model
judgement entirely, while still using the LLM's reasoning for what rules
alone can't catch.

## Google Cloud pieces

| Component | Google Cloud service | Notes |
|---|---|---|
| Agent runtime | ADK 2.10.0 (`google-adk`) | `LlmAgent`, `ParallelAgent`, `SequentialAgent`, custom `BaseAgent` |
| LLM | Gemini via Vertex AI | See "Flagged: model IDs" below |
| Data store | Firestore (native mode) | `fi_data`, `consent`, `claims`, `ledger`, `decisions` collections |
| Backend | Cloud Run (FastAPI) | `backend/main.py` |
| Frontend | Cloud Run (Express, static) | `frontend/server.js` |
| Region | `asia-south1` (Mumbai) | Latency + regulatory optics for India-specific data model |

## Flagged, not silently assumed: exact Gemini model IDs

The build brief names the intended tiers as **Gemini 3.8 Flash** (the three
specialist sub-agents) and **Gemini 3.1 Pro** (the orchestrator's
reasoning pass), and explicitly says the exact Vertex AI model ID string
needs to be confirmed against the live model list at build time, since
marketing names and API IDs can diverge. This sandbox had no Vertex AI
credentials to check that list, so `agents/config.py` ships
`gemini-3.8-flash` / `gemini-3.1-pro` as best-guess placeholders, not
verified API IDs. **Before Phase 2, run:**

```bash
gcloud ai models list --region=asia-south1
```

and correct `SPECIALIST_MODEL` / `ORCHESTRATOR_MODEL` (env vars, see
`.env.example`) if they don't match.

## The JAPAC reframe (say this explicitly, don't leave it implicit)

Account Aggregator is India's instantiation of a broader pattern -
consent-based, multi-source open-finance data sharing - that also exists as
Australia's Consumer Data Right, Singapore's SGFinDex, and emerging open
banking frameworks in Japan and Korea. The contradiction-detection engine
and the consent-lifecycle logic are built against that general pattern; AA
is simply the first data adapter, chosen because it's buildable and
demoable fastest. Swap the adapter, keep the reasoning engine, ship in a
new market. State this once, clearly, early in the demo video and the deck
- don't leave it for a judge to infer.

## Roadmap gates

| Phase | Dates | Gate |
|---|---|---|
| 1. Architecture and setup | Sep 27 - Oct 2 | Architecture decided, empty skeleton deployed and reachable |
| 2. Core agent build | Oct 3 - Oct 10 | One borrower, end to end, produces a real decision with citations (the golden path) |
| 3. Integration and deploy | Oct 11 - Oct 14 | Full multi-agent system live on a public URL |
| 4. Demo, polish, submit | Oct 15 - Oct 17 | All four submission artifacts ready, submitted a day early |

The core build (Phase 2) is deliberately the longest phase - a working
golden path by Oct 10 matters more than anything that comes after it.
