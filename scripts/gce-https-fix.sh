#!/usr/bin/env bash
# Run from Mac – firewall + Caddy setup on GCE VM
# Usage: ./scripts/gce-https-fix.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROJECT=mindmemosg3
ZONE=us-central1-a
VM=mindmemos-https

echo "=== 1. Firewall: ensure http-server tag and allow 80/443 ==="
gcloud compute instances add-tags "$VM" \
  --zone="$ZONE" \
  --tags=http-server \
  --project="$PROJECT"

gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server \
  --project="$PROJECT" 2>/dev/null || true

gcloud compute firewall-rules create allow-https \
  --allow=tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server \
  --project="$PROJECT" 2>/dev/null || true

echo "=== 2. Copy and run Caddy setup on VM ==="
gcloud compute scp "$SCRIPT_DIR/setup-caddy-https.sh" "${VM}:/tmp/setup-caddy-https.sh" \
  --zone="$ZONE" --project="$PROJECT"
gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" \
  --command="chmod +x /tmp/setup-caddy-https.sh && /tmp/setup-caddy-https.sh"

echo ""
echo "=== 3. Rebuild and redeploy app (run manually if needed) ==="
echo "  cd $REPO_ROOT && ./scripts/deploy-gce.sh"
echo "  gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --command='sudo docker pull us-central1-docker.pkg.dev/$PROJECT/mindmemos/server:latest && sudo docker restart mindmemos'"
echo ""
echo "=== 4. Visit https://35.238.170.247.sslip.io (hard refresh: Cmd+Shift+R) ==="
