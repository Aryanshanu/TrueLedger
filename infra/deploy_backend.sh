#!/usr/bin/env bash
# Deploys the agent backend to Cloud Run. Run from the repo root.
# Requires: gcloud CLI authenticated, GOOGLE_CLOUD_PROJECT set, and the
# Cloud Run / Artifact Registry / Vertex AI APIs enabled on that project.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
REGION="${GOOGLE_CLOUD_LOCATION:-asia-south1}"
SERVICE="outliers-backend"
IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/outliers/${SERVICE}"

gcloud builds submit --project "$GOOGLE_CLOUD_PROJECT" --tag "$IMAGE" -f backend/Dockerfile .

gcloud run deploy "$SERVICE" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_VERTEXAI=TRUE"

echo "Backend deployed. URL:"
gcloud run services describe "$SERVICE" --project "$GOOGLE_CLOUD_PROJECT" --region "$REGION" --format 'value(status.url)'
