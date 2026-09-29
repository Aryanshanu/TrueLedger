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

## Flagged, not silently assumed: exact Gemini model IDs and call location

The build brief names the intended tiers as **Gemini 3.8 Flash** (the three
specialist sub-agents) and **Gemini 3.1 Pro** (the orchestrator's
reasoning pass), and explicitly says the exact Vertex AI model ID string
needs to be confirmed against the live model list at build time, since
marketing names and API IDs can diverge.

- **`SPECIALIST_MODEL` = `gemini-3.8-flash` is CONFIRMED**, checked directly
  against the live Model Garden console page (Sept 2026, read and pasted
  back by the team): "Model name: gemini-3.8-flash" under Model details -
  matches the placeholder exactly.
- **`ORCHESTRATOR_MODEL` = `gemini-3.1-pro-preview` is CONFIRMED, but by web
  search rather than a direct console read** (this sandbox's network proxy
  blocks `docs.cloud.google.com`/`ai.google.dev`/`deepmind.google`
  outright, so the page itself couldn't be fetched here - cross-referenced
  instead across the official Vertex AI docs, Google's blog post, and
  multiple developer forum threads, all agreeing). Two corrections from the
  original placeholder:
  1. The Resource ID carries a **`-preview`** suffix - `gemini-3.1-pro`
     alone is wrong and will fail.
  2. This preview model is **global-endpoint-only**, full stop - not one
     option among several we picked "global" for. A forum thread of people
     explicitly requesting regional/data-residency access for it were told
     it isn't offered. Firestore/Cloud Run correctly stay in `asia-south1`;
     be ready to explain that the orchestrator's Gemini call itself
     necessarily goes through Google's global endpoint, since that's this
     model's only option, not a trade-off this team chose. Do one quick
     personal console check to be fully certain, the same way you did for
     Flash.
- **`gcloud ai models list --region=...` is the wrong command** for this -
  it lists your own project's custom Model Registry entries, not Google's
  publisher/foundation models, and will correctly show `Listed 0 items`
  even when Gemini access is fine. Use the Model Garden console instead.
- **The Vertex AI call location is `"global"`, not `asia-south1`,** despite
  Cloud Run/Firestore staying in `asia-south1`. Confirmed from Google's own
  Gemini 3.8 Flash sample code (`client = genai.Client(enterprise=True,
  project=..., location="global")`, and the curl sample's endpoint host
  drops the region prefix entirely for global) - and ADK's own `Gemini`
  model wrapper documents the identical pattern. See `VERTEX_AI_LOCATION`
  and the `build_specialist_model()`/`build_orchestrator_model()` helpers
  in `agents/config.py`, which pass this explicitly via `client_kwargs`
  rather than through an environment variable.
- **The env var name for enabling Vertex/enterprise mode changed.** The
  installed `google-genai==2.25.0` SDK's `Client` only documents
  `GOOGLE_GENAI_USE_ENTERPRISE` - the older `GOOGLE_GENAI_USE_VERTEXAI`
  name (used in an earlier draft of this config) doesn't appear anywhere in
  its source. This is exactly why the fix above passes `enterprise=True`
  explicitly in code instead of trusting an SDK-read env var name that has
  already drifted once.

If a future model tier isn't available at `location="global"`, override
`VERTEX_AI_LOCATION` (env var, see `.env.example`) to whichever region
Model Garden shows it in.

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
