#!/usr/bin/env bash
# Deploys the frontend to Cloud Run, pointed at an already-deployed backend.
# Usage: BACKEND_URL=https://trueledger-backend-xyz.run.app ./infra/deploy_frontend.sh
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
: "${BACKEND_URL:?Set BACKEND_URL to the deployed backend's Cloud Run URL first}"
REGION="${GOOGLE_CLOUD_LOCATION:-asia-south1}"
SERVICE="trueledger-frontend"
IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/trueledger/${SERVICE}"

gcloud builds submit --project "$GOOGLE_CLOUD_PROJECT" --tag "$IMAGE" frontend/

gcloud run deploy "$SERVICE" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "BACKEND_URL=${BACKEND_URL}"

echo "Frontend deployed. URL:"
gcloud run services describe "$SERVICE" --project "$GOOGLE_CLOUD_PROJECT" --region "$REGION" --format 'value(status.url)'
