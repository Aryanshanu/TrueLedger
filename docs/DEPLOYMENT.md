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
already builds with the correct root context via a `cloudbuild.yaml`
config (`gcloud builds submit --config cloudbuild.yaml ...`) - confirmed
live that `gcloud builds submit --tag ... -f backend/Dockerfile` doesn't
work at all, on any gcloud version: `--tag` mode has no flag to point at a
non-default Dockerfile path, so a build config is the only correct way to
build from `backend/Dockerfile` while keeping repo-root context.

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

**Confirmed live** (`asia-south1`, `min-instances=1` on both services):
`b_clean` -> approve (0.95), `b_contradiction` -> manual_review (0.50,
`income_vs_revenue_divergence` flagged), `b_stale_consent` -> decline
(0.00, consent decay). Vertex AI and Firestore both work correctly from
Cloud Run itself, not just with local ADC credentials.

One `curl`-specific gotcha, not a backend bug: Cloud Run's load balancer
rejects a bodyless `POST` without an explicit `Content-Length: 0` header
(`curl -X POST url` alone can get a `411 Length Required`). Use
`curl -X POST -H "Content-Length: 0" url`. Browsers and the frontend's own
`fetch()` calls already send this correctly, so it only bites `curl`.

## 8. Continuous deployment from GitHub (optional)

Connects this GCP project to the GitHub repo so every push to `main`
rebuilds and redeploys both services automatically - no more running
`infra/deploy_backend.sh` / `infra/deploy_frontend.sh` by hand. Uses
`infra/cloudbuild.ci.backend.yaml` / `infra/cloudbuild.ci.frontend.yaml`
(separate from the manual-deploy configs so this can never break the
already-verified manual path).

**One step here can't be scripted**: connecting Cloud Build to your GitHub
account requires authorizing the Google Cloud Build GitHub App in a
browser - `gcloud builds repositories create` prints a URL for this and
waits for you to complete it there.

```bash
export GOOGLE_CLOUD_PROJECT=<PROJECT_ID>
export GITHUB_OWNER=<your-github-username-or-org>
export GITHUB_REPO=<your-repo-name>   # e.g. TrueLedger
gcloud config set project "$GOOGLE_CLOUD_PROJECT"

# One-time: let Cloud Build call Cloud Run on your behalf.
PROJECT_NUMBER=$(gcloud projects describe "$GOOGLE_CLOUD_PROJECT" --format='value(projectNumber)')
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member "serviceAccount:${CLOUDBUILD_SA}" --role roles/run.admin
gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member "serviceAccount:${CLOUDBUILD_SA}" --role roles/iam.serviceAccountUser

# Connect this GCP project to your GitHub account (2nd-gen Cloud Build
# GitHub integration). Opens a browser tab to authorize - complete that,
# then come back to the terminal.
gcloud builds connections create github trueledger-github \
  --project "$GOOGLE_CLOUD_PROJECT" --region asia-south1

# Link the specific repo through that connection.
gcloud builds repositories create trueledger-repo \
  --project "$GOOGLE_CLOUD_PROJECT" --region asia-south1 \
  --connection trueledger-github \
  --remote-uri "https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git"

# Create the two triggers - push to main rebuilds+redeploys both services.
gcloud builds triggers create github \
  --project "$GOOGLE_CLOUD_PROJECT" --region asia-south1 \
  --name trueledger-backend-ci \
  --repository "projects/${GOOGLE_CLOUD_PROJECT}/locations/asia-south1/connections/trueledger-github/repositories/trueledger-repo" \
  --branch-pattern '^main$' \
  --build-config infra/cloudbuild.ci.backend.yaml

gcloud builds triggers create github \
  --project "$GOOGLE_CLOUD_PROJECT" --region asia-south1 \
  --name trueledger-frontend-ci \
  --repository "projects/${GOOGLE_CLOUD_PROJECT}/locations/asia-south1/connections/trueledger-github/repositories/trueledger-repo" \
  --branch-pattern '^main$' \
  --build-config infra/cloudbuild.ci.frontend.yaml
```

Verify: push anything to `main`, then watch it build at
`https://console.cloud.google.com/cloud-build/builds?project=<PROJECT_ID>`,
or tail it from the CLI:

```bash
gcloud builds list --project "$GOOGLE_CLOUD_PROJECT" --region asia-south1 --limit 5
```

The backend trigger must finish before the frontend trigger's build step
(which looks up the live backend URL) makes sense to run - on the very
first push after setup, give the backend build a minute's head start, or
just push once, wait for backend to go green, then push again (an empty
commit is fine) to let the frontend trigger pick up a backend URL that
already exists.

## Cost and reliability guardrails - don't skip these

- **Set a budget alert on the GCP project now, not after a surprise bill**
  (Billing -> Budgets & alerts -> Create budget, e.g. ₹500/day). This is
  the single highest-leverage five minutes you can spend - it emails you
  before a billing account goes delinquent instead of after.
- **Default to `min-instances=0` on both Cloud Run services during
  development.** `infra/deploy_backend.sh` / `deploy_frontend.sh` and the
  GitHub CI configs (`infra/cloudbuild.ci.*.yaml`) all pass
  `--min-instances=0` unless you explicitly set `MIN_INSTANCES=1`. An
  always-on instance bills continuously whether or not anyone is hitting
  it - with two services running 24/7 across a multi-day build, this is
  normally the largest line item on the bill, not Gemini calls or Cloud
  Build minutes. Only bump to 1 right before a live judged demo:
  ```bash
  gcloud run services update trueledger-backend  --region asia-south1 --min-instances=1
  gcloud run services update trueledger-frontend --region asia-south1 --min-instances=1
  # ...then scale back down right after:
  gcloud run services update trueledger-backend  --region asia-south1 --min-instances=0
  gcloud run services update trueledger-frontend --region asia-south1 --min-instances=0
  ```
  (This replaces the earlier version of this doc, which told you to set
  `min-instances=1` "a day or two before the deadline" - correct in spirit,
  but it's easy to set it once early and forget it's still billing. If you
  already did this, check now: `gcloud run services describe <service>
  --region asia-south1 --format 'value(spec.template.spec.containerConcurrency,
  metadata.annotations)'` or just look at the service's "Minimum instances"
  field in the Cloud Run console.)
- **The GitHub CI triggers (`docs/DEPLOYMENT.md` §8) rebuild and redeploy
  on every push to `main`.** Each push burns Cloud Build minutes and
  creates a new Cloud Run revision; `gcloud run deploy` without an explicit
  `--min-instances` flag *carries over* whatever the previous revision had,
  so a stray `min-instances=1` can survive across many redeploys without
  you ever having asked for it again. If a work session means many commits
  in a row (common with an AI pair-programmer), consider pausing the
  trigger (`gcloud builds triggers run` is manual-only; disable the
  trigger in Cloud Build console) and deploying manually once per session
  instead of on every push.
- **Use the cheaper model while iterating.** `SPECIALIST_MODEL` and
  `ORCHESTRATOR_MODEL` are env vars (`agents/config.py`) - set
  `ORCHESTRATOR_MODEL=gemini-3.8-flash` locally while testing pipeline
  logic/UI, and only run against the real `gemini-3.1-pro-preview` for
  verification passes you actually need. Every `/borrowers/upload` or
  Evaluate click is 4 LLM calls (3 specialists + orchestrator); repeated
  manual testing against the full-price model adds up fast.
- **Prefer local dev over live Cloud Run for anything that isn't a final
  check.** `uvicorn backend.main:app --reload` + `node frontend/server.js`
  locally still talk to real Vertex AI/Firestore if you export the same
  env vars - you don't need the Cloud Run deployment live just to iterate.
  The frontend's scratchpad mock-backend pattern (see this repo's test
  setup) avoids even the Gemini cost for pure UI work.
- Never commit credentials - `.gitignore` already covers `.env` and
  `*-service-account*.json` / `*.key.json`; verified clean against this
  repo's git history as of the Phase 1 scaffold (only `.env.example` was
  ever committed).
- Keep the GitHub repo public well before Oct 18, not as a last step.

### If billing is already delinquent

Only the account owner can fix this (it's a payment-method/financial
action - no CLI tool, including this one, can do it for you):

1. https://console.cloud.google.com/billing -> select the billing account
   tied to the `truledger` project -> update the payment method or clear
   the outstanding balance -> wait for status to flip from delinquent to
   active (usually near-instant once the payment method succeeds).
2. Once active, redeploy with `./infra/deploy_frontend.sh` /
   `deploy_backend.sh` as usual (now defaulting to `min-instances=0`, so
   this won't recreate the same always-on cost).
3. Check whether the **Google AI Builder Cup** organizers issued a GCP
   credit code for registered teams (hackathon portal / confirmation
   email) - most Google-run hackathons do, and applying it to the billing
   account is the fastest way to both clear a delinquent balance and cover
   the rest of the build. Worth checking before putting in a personal card.

### What every team is almost certainly doing differently

Nobody else's exact bill is visible from here, but the pattern that keeps
a hackathon's GCP spend near zero is the same for every team: scale-to-zero
Cloud Run (no `min-instances` set at all until demo day), iterate against
`uvicorn --reload` / local Node rather than redeploying per change, use the
cheaper model tier for day-to-day testing, and rely on the hackathon's
provided credit grant rather than a personal card for the one or two
GCP-native services (Cloud Run, Firestore, Vertex AI) that can't be run
free locally.
