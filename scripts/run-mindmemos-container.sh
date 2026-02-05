#!/usr/bin/env bash
# Run this ON THE VM (mindmemos-prod) after filling in the secrets below.
# Or run via: gcloud compute ssh mindmemos-prod --zone=us-central1-a --project=mindmemosg3
# Then paste and run the commands.

set -e

# === FILL IN THESE ===
MONGODB_URI="YOUR_MONGODB_URI"
JWT_SECRET="YOUR_JWT_SECRET"
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# Get VM external IP
NEW_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
FRONTEND_URL="https://${NEW_IP}.sslip.io"

echo "Using FRONTEND_URL=$FRONTEND_URL"

gcloud auth configure-docker us-central1-docker.pkg.dev --quiet 2>/dev/null || true
docker pull us-central1-docker.pkg.dev/mindmemosg3/mindmemos/server:latest

docker stop mindmemos 2>/dev/null || true
docker rm mindmemos 2>/dev/null || true

# Option A: With JSON credentials file (copy to /opt/mindmemos/credentials.json first)
if [ -f /opt/mindmemos/credentials.json ]; then
  docker run -d --name mindmemos --restart=unless-stopped \
    -p 127.0.0.1:3000:3000 \
    -e NODE_ENV=production \
    -e PORT=3000 \
    -e MONGODB_URI="$MONGODB_URI" \
    -e JWT_SECRET="$JWT_SECRET" \
    -e GEMINI_API_KEY="$GEMINI_API_KEY" \
    -e FRONTEND_URL="$FRONTEND_URL" \
    -v /opt/mindmemos/credentials.json:/app/credentials.json:ro \
    -e GOOGLE_APPLICATION_CREDENTIALS=/app/credentials.json \
    us-central1-docker.pkg.dev/mindmemosg3/mindmemos/server:latest
else
  # Option B: Use VM service account (must have Speech-to-Text + Text-to-Speech roles)
  docker run -d --name mindmemos --restart=unless-stopped \
    -p 127.0.0.1:3000:3000 \
    -e NODE_ENV=production \
    -e PORT=3000 \
    -e MONGODB_URI="$MONGODB_URI" \
    -e JWT_SECRET="$JWT_SECRET" \
    -e GEMINI_API_KEY="$GEMINI_API_KEY" \
    -e FRONTEND_URL="$FRONTEND_URL" \
    us-central1-docker.pkg.dev/mindmemosg3/mindmemos/server:latest
fi

echo "Container started. Check: docker logs -f mindmemos"
