#!/usr/bin/env bash
# Deploy MindMemos to Google Compute Engine (backend + optional frontend on same VM).
# Usage:
#   1. Set PROJECT_ID and optionally BACKEND_URL (your GCE backend URL, e.g. http://EXTERNAL_IP:3000)
#   2. Run: ./scripts/deploy-gce.sh [build-only|create-vm]
#
# Prerequisites: gcloud CLI, Node 18+, Angular CLI. Enable Compute Engine + Artifact Registry APIs.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- Configure these ---
export PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo 'YOUR_PROJECT_ID')}"
export ZONE="${GCE_ZONE:-us-central1-a}"
export VM_NAME="${GCE_VM_NAME:-mindmemos-server}"
export IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/mindmemos/server:latest"
export ADDRESS_NAME="${GCE_ADDRESS_NAME:-mindmemos-server-ip}"

# Backend URL for the Angular build (use your VM external IP after first deploy, or a domain)
# Example: http://34.41.61.232:3000  or  https://api.yourdomain.com
export BACKEND_URL="${BACKEND_URL:-http://YOUR_VM_EXTERNAL_IP:3000}"

if [ "$PROJECT_ID" = "YOUR_PROJECT_ID" ]; then
  echo "Set GCP_PROJECT_ID (or edit PROJECT_ID in this script)."
  exit 1
fi

if [ -z "$BACKEND_URL" ] || [ "$BACKEND_URL" = "http://YOUR_VM_EXTERNAL_IP:3000" ]; then
  ENV_PROD_FILE="$REPO_ROOT/client/src/environments/environment.prod.ts"
  # Use production URL from env file if it already has the HTTPS IP (avoids wrong fallback)
  if [ -f "$ENV_PROD_FILE" ] && grep -q "35.238.170.247" "$ENV_PROD_FILE" 2>/dev/null; then
    BACKEND_URL="https://35.238.170.247"
  elif gcloud compute instances describe mindmemos-https --zone="$ZONE" --project="$PROJECT_ID" >/dev/null 2>&1; then
    HTTPS_IP=$(gcloud compute instances describe mindmemos-https --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)' --project="$PROJECT_ID")
    BACKEND_URL="https://${HTTPS_IP}"
  elif gcloud compute addresses describe "$ADDRESS_NAME" --region=us-central1 --project="$PROJECT_ID" >/dev/null 2>&1; then
    STATIC_IP=$(gcloud compute addresses describe "$ADDRESS_NAME" --region=us-central1 --format='get(address)' --project="$PROJECT_ID")
    BACKEND_URL="http://${STATIC_IP}:3000"
  elif gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" >/dev/null 2>&1; then
    VM_IP=$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)' --project="$PROJECT_ID")
    BACKEND_URL="http://${VM_IP}:3000"
  else
    echo "Set BACKEND_URL (e.g. BACKEND_URL=https://35.238.170.247 ./scripts/deploy-gce.sh)"
    exit 1
  fi
fi

echo "Project: $PROJECT_ID  Zone: $ZONE  VM: $VM_NAME"
echo "Backend URL for frontend: $BACKEND_URL"
echo ""

# 1. Create Artifact Registry repo if missing
if ! gcloud artifacts repositories describe mindmemos --location=us-central1 --project="$PROJECT_ID" 2>/dev/null; then
  echo "Creating Artifact Registry repository..."
  gcloud artifacts repositories create mindmemos \
    --repository-format=docker \
    --location=us-central1 \
    --project="$PROJECT_ID" \
    --description="MindMemos server images"
fi

# 2. Build Angular with production apiUrl
ENV_PROD="$REPO_ROOT/client/src/environments/environment.prod.ts"
ENV_PROD_FILE="$ENV_PROD"
cp "$ENV_PROD" "${ENV_PROD}.bak"
# Same-origin prod (apiUrl: '/api') is not patched; otherwise patch BACKEND_URL into env for build
if grep -q "apiUrl: '/api'" "$ENV_PROD" 2>/dev/null; then
  echo "Building Angular client (same-origin apiUrl=/api, no patch)..."
else
  if [ -z "$BACKEND_URL" ] || [ "$BACKEND_URL" = "http://YOUR_VM_EXTERNAL_IP:3000" ]; then
    [ -f "$ENV_PROD_FILE" ] && grep -q "35.238.170.247" "$ENV_PROD_FILE" 2>/dev/null && BACKEND_URL="https://35.238.170.247"
  fi
  echo "Building Angular client (apiUrl=$BACKEND_URL)..."
  API_URL="${BACKEND_URL}/api"
  WS_URL="${BACKEND_URL/http:/ws:}"
  WS_URL="${WS_URL/https:/wss:}/voice-gateway"
  sed -i.tmp "s|apiUrl:.*|apiUrl: '$API_URL',|" "$ENV_PROD"
  sed -i.tmp "s|voiceGatewayUrl:.*|voiceGatewayUrl: '$WS_URL',|" "$ENV_PROD"
  sed -i.tmp "s|return 'wss://[^']*';|return '$WS_URL';|" "$ENV_PROD"
  rm -f "${ENV_PROD}.tmp"
fi
cd "$REPO_ROOT/client"
# Clean node_modules to avoid npm ci ENOTEMPTY (e.g. electron-to-chromium rmdir on macOS)
rm -rf node_modules
npm ci --quiet
npx ng build --configuration=production
cd "$REPO_ROOT"
mv "${ENV_PROD}.bak" "$ENV_PROD"

# 3. Copy client build into server/public-app for single-VM deploy
echo "Copying client build to server/public-app..."
rm -rf server/public-app
mkdir -p server/public-app
if [ -d "client/dist/client/browser" ]; then
  cp -r client/dist/client/browser/* server/public-app/
elif [ -d "client/dist/client" ] && [ -f "client/dist/client/index.html" ]; then
  cp -r client/dist/client/* server/public-app/
else
  echo "Angular build output not found. Expected client/dist/client/browser or client/dist/client with index.html"
  exit 1
fi

# 4. Build and push Docker image (Cloud Build - no local Docker needed)
echo "Building and pushing Docker image..."
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
cd server
gcloud builds submit --tag "$IMAGE" --project="$PROJECT_ID" .
cd "$REPO_ROOT"

echo ""
echo "Image pushed: $IMAGE"
echo ""
echo "--- Next: create the GCE VM (one-time) and pass env vars ---"
echo "Run the following (replace the placeholder env values with your real secrets):"
echo ""
echo "gcloud compute firewall-rules create allow-mindmemos-http --allow=tcp:3000 --target-tags=http-server --source-ranges=0.0.0.0/0 --project=$PROJECT_ID 2>/dev/null || true"
echo ""
echo "gcloud compute instances create-with-container $VM_NAME \\"
echo "  --zone=$ZONE \\"
echo "  --machine-type=e2-medium \\"
echo "  --container-image=$IMAGE \\"
echo "  --container-restart-policy=always \\"
echo "  --container-env=PORT=3000,NODE_ENV=production \\"
echo "  --container-env=GEMINI_API_KEY=YOUR_GEMINI_KEY \\"
echo "  --container-env=MONGODB_URI=YOUR_MONGODB_URI \\"
echo "  --container-env=JWT_SECRET=YOUR_JWT_SECRET \\"
echo "  --container-env=FRONTEND_URL=$BACKEND_URL \\"
echo "  --tags=http-server \\"
echo "  --project=$PROJECT_ID"
echo ""
echo "Then get the VM IP:"
echo "  gcloud compute instances describe $VM_NAME --zone=$ZONE --format='get(networkInterfaces[0].accessConfigs[0].natIP)' --project=$PROJECT_ID"
echo ""
echo "App URL: http://EXTERNAL_IP:3000  (same VM serves API + frontend)"
