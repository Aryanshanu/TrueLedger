#!/usr/bin/env bash
# Deploys the agent backend to Cloud Run. Run from the repo root.
# Requires: gcloud CLI authenticated, GOOGLE_CLOUD_PROJECT set, and the
# Cloud Run / Artifact Registry / Vertex AI APIs enabled on that project.
#
# NOTE: this does NOT use `gcloud run deploy --source backend/` - the
# Dockerfile needs repo-root build context to COPY the shared agents/
# package (see backend/Dockerfile's header comment), which a `backend/`-
# scoped source build would not have. Use this script instead.
#
# Optional: set SERVICE_ACCOUNT to a dedicated runner service account
# (e.g. truledger-runner@<PROJECT_ID>.iam.gserviceaccount.com) rather than
# deploying with the default compute service account.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
REGION="${GOOGLE_CLOUD_LOCATION:-asia-south1}"
SERVICE="trueledger-backend"
IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/trueledger/${SERVICE}"

gcloud builds submit --project "$GOOGLE_CLOUD_PROJECT" --config cloudbuild.yaml --substitutions "_IMAGE=${IMAGE}" .

DEPLOY_ARGS=(
  "$SERVICE"
  --project "$GOOGLE_CLOUD_PROJECT"
  --region "$REGION"
  --image "$IMAGE"
  --platform managed
  --allow-unauthenticated
  # GOOGLE_CLOUD_PROJECT is the only Gemini-relevant env var the container
  # needs: each agent passes enterprise=True and location=VERTEX_AI_LOCATION
  # explicitly in code (agents/config.py), rather than relying on an SDK
  # environment variable whose name has already changed once
  # (GOOGLE_GENAI_USE_VERTEXAI -> GOOGLE_GENAI_USE_ENTERPRISE). Set
  # VERTEX_AI_LOCATION below only to override the "global" default.
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},GOOGLE_CLOUD_LOCATION=${REGION}${VERTEX_AI_LOCATION:+,VERTEX_AI_LOCATION=${VERTEX_AI_LOCATION}}"
)
if [[ -n "${SERVICE_ACCOUNT:-}" ]]; then
  DEPLOY_ARGS+=(--service-account "$SERVICE_ACCOUNT")
fi

gcloud run deploy "${DEPLOY_ARGS[@]}"

echo "Backend deployed. URL:"
gcloud run services describe "$SERVICE" --project "$GOOGLE_CLOUD_PROJECT" --region "$REGION" --format 'value(status.url)'
