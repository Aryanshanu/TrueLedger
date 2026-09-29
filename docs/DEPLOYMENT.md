# Deployment runbook

Run this from the repo root, in order, once you're at the keyboard with
your own Google Cloud credentials (this sandbox has none, so none of this
has been run live - only smoke-tested locally, see `README.md` Status).

## 1. Project and APIs

```bash
gcloud config set project <PROJECT_ID>
gcloud config set run/region asia-south1
gcloud services enable aiplatform.googleapis.com firestore.googleapis.com \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## 2. Auth

```bash
gcloud auth login
gcloud auth application-default login
```

For the deployed Cloud Run services, use a dedicated service account rather
than personal credentials:

```bash
gcloud iam service-accounts create trueledger-runner --display-name "TrueLedger agent runner"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member "serviceAccount:trueledger-runner@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role roles/aiplatform.user
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member "serviceAccount:trueledger-runner@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role roles/datastore.user
```

## 3. Confirm the real Gemini model IDs

`SPECIALIST_MODEL` (`gemini-3.8-flash`) is confirmed directly against the
console. `ORCHESTRATOR_MODEL` (`gemini-3.1-pro-preview`) is confirmed via
web search cross-referenced across official docs and forum threads, but
not yet eyeballed against the console directly - do that once:

**Don't use `gcloud ai models list --region=...`** - that lists your own
project's custom Model Registry, not Google's Gemini models, and will show
`Listed 0 items` even when everything is fine (learned this the hard way -
see `docs/ARCHITECTURE.md` "Flagged: exact Gemini model IDs and call
location"). Instead, use the console:

```
https://console.cloud.google.com/vertex-ai/model-garden?project=<PROJECT_ID>
```

Search "Gemini", open the Pro-tier card, and confirm its Resource ID reads
`gemini-3.1-pro-preview` (note the `-preview` suffix) under "Model
details", and that it's marked global-endpoint-only rather than available
in `asia-south1` or another region.

While you're there, also note whether either tier is unavailable at
`location="global"` (the confirmed-correct Vertex AI call location for
Gemini 3.8 Flash - not `asia-south1`, see `agents/config.py`'s
`VERTEX_AI_LOCATION`; `gemini-3.1-pro-preview` has no regional option at
all). If one is missing from `global`, set
`VERTEX_AI_LOCATION` to whichever region it does show.

## 4. Firestore

- Create a Native-mode Firestore database in the same project/region if one
  doesn't already exist (Console: Firestore -> Create database -> Native
  mode -> `asia-south1`).
- Seed the three synthetic borrowers:
  ```bash
  python -m infra.seed_firestore
  ```

## 5. Run it live, locally first

```bash
export GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
export GOOGLE_CLOUD_LOCATION=asia-south1
PYTHONPATH=. uvicorn backend.main:app --reload --port 8081

curl -X POST localhost:8081/borrowers/b_contradiction/evaluate
curl localhost:8081/borrowers/b_contradiction/ledger
```

Confirm the ledger response actually shows the bank-vs-GST contradiction
before deploying anything - catching a bug locally costs minutes, catching
it on Cloud Run costs a rebuild-and-redeploy cycle.

## 6. Deploy to Cloud Run

**Use the provided scripts, not a bare `gcloud run deploy --source backend/`.**
`backend/Dockerfile` needs repo-root build context to `COPY` the shared
`agents/` package (see the comment at the top of that Dockerfile); a
`--source backend/` build only sees the `backend/` subtree, so the shared
package would be missing and the build would fail. `infra/deploy_backend.sh`
already builds with the correct root context via `gcloud builds submit -f
backend/Dockerfile .`.

```bash
export GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
export SERVICE_ACCOUNT=trueledger-runner@<PROJECT_ID>.iam.gserviceaccount.com  # optional
./infra/deploy_backend.sh

export BACKEND_URL=$(gcloud run services describe trueledger-backend --region asia-south1 --format 'value(status.url)')
./infra/deploy_frontend.sh
```

## 7. Verify live, not local

Hit the live backend URL with the same `curl` calls from step 5, then open
the live frontend URL and click through the replay UI for
`b_contradiction` in an actual browser. This is what closes the Phase 3
gate ("multi-agent + explainability UI live on Cloud Run") - a passing
local test is not the same claim.

## Cost and reliability guardrails - don't skip these

- Set a budget alert on the GCP project before running anything against
  real Vertex AI - an agentic pipeline with 4 LLM calls per evaluation adds
  up faster than a single-prompt app during testing.
- Never commit credentials - `.gitignore` already covers `.env` and
  `*-service-account*.json` / `*.key.json`; verified clean against this
  repo's git history as of the Phase 1 scaffold (only `.env.example` was
  ever committed).
- Set `min-instances=1` on both Cloud Run services (`gcloud run services
  update <service> --min-instances=1`) a day or two before the deadline,
  not at submission time - scale-to-zero means a judge's first request
  eats a cold-start delay.
- Keep the GitHub repo public well before Oct 18, not as a last step.
