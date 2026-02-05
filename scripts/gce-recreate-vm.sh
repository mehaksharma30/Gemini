#!/usr/bin/env bash
# Recreate mindmemos-server GCE VM with env vars from server/.env so the app listens on port 3000.
# Run from repo root: ./scripts/gce-recreate-vm.sh
# Requires: gcloud CLI, server/.env with GEMINI_API_KEY, MONGODB_URI, JWT_SECRET
#
# IMPORTANT: For the app to serve the frontend at / (not 404), the Docker image must include
# the Angular build in server/public-app. Run ./scripts/deploy-gce.sh first (with BACKEND_URL
# and GCP_PROJECT_ID set), then run this script so the new VM uses that image.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

# Load env (export only the vars we need; avoid xargs for portability)
while IFS= read -r line; do
  case "$line" in
    GEMINI_API_KEY=*) export "$line" ;;
    MONGODB_URI=*)    export "$line" ;;
    JWT_SECRET=*)     export "$line" ;;
  esac
done < <(grep -E '^GEMINI_API_KEY=|^MONGODB_URI=|^JWT_SECRET=' "$ENV_FILE")

if [ -z "${GEMINI_API_KEY:-}" ] || [ -z "${MONGODB_URI:-}" ] || [ -z "${JWT_SECRET:-}" ]; then
  echo "Ensure server/.env has GEMINI_API_KEY, MONGODB_URI, JWT_SECRET (no quotes/placeholders)"
  exit 1
fi

PROJECT="mindmemosg3"
ZONE="us-central1-a"
ADDRESS_NAME="${GCE_ADDRESS_NAME:-mindmemos-server-ip}"

echo "Ensuring a reserved static external IP exists..."
if ! gcloud compute addresses describe "$ADDRESS_NAME" --region=us-central1 --project=$PROJECT >/dev/null 2>&1; then
  gcloud compute addresses create "$ADDRESS_NAME" --region=us-central1 --project=$PROJECT
fi
STATIC_IP=$(gcloud compute addresses describe "$ADDRESS_NAME" --region=us-central1 --format='get(address)' --project=$PROJECT)

echo "Deleting existing VM (if any)..."
gcloud compute instances delete mindmemos-server --zone=$ZONE --project=$PROJECT --quiet 2>/dev/null || true

echo "Creating VM with container and real env..."
gcloud compute instances create-with-container mindmemos-server \
  --zone=$ZONE \
  --machine-type=e2-medium \
  --address="$STATIC_IP" \
  --container-image=us-central1-docker.pkg.dev/mindmemosg3/mindmemos/server:latest \
  --container-restart-policy=always \
  --container-env="PORT=3000" \
  --container-env="NODE_ENV=production" \
  --container-env=GEMINI_API_KEY="$GEMINI_API_KEY" \
  --container-env=MONGODB_URI="$MONGODB_URI" \
  --container-env=JWT_SECRET="$JWT_SECRET" \
  --tags=http-server \
  --project=$PROJECT

VM_IP="$STATIC_IP"
echo ""
echo "VM ready. App URL: http://${VM_IP}:3000"
echo "Wait ~60 seconds for the container to start, then open in browser. (Frontend and API are same origin, so CORS is fine.)"
echo ""
echo "If registration/login still times out, the frontend bundle may be using an old API URL. Rebuild and redeploy with:"
echo "  BACKEND_URL=http://${VM_IP}:3000 ./scripts/deploy-gce.sh"
echo "  ./scripts/gce-recreate-vm.sh"
