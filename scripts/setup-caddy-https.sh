#!/usr/bin/env bash
# Run this ON THE GCE VM (or via: gcloud compute ssh mindmemos-https --zone=us-central1-a --project=mindmemosg3 < scripts/setup-caddy-https.sh)
# Sets up Caddy + Let's Encrypt for 35.238.170.247.sslip.io

set -e

echo "=== Stopping nginx if present ==="
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true

echo "=== Installing Caddy ==="
sudo apt-get update -y
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -y
sudo apt-get install -y caddy

echo "=== Deploying Caddyfile ==="
sudo tee /etc/caddy/Caddyfile << 'CADDYEOF'
35.238.170.247.sslip.io {
    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
CADDYEOF

echo "=== Validating Caddyfile ==="
sudo caddy validate --config /etc/caddy/Caddyfile

echo "=== Restarting Caddy ==="
sudo systemctl restart caddy
sudo systemctl enable caddy

echo "=== Caddy status ==="
sudo systemctl status caddy --no-pager
echo ""
echo "=== Caddy logs (last 30 lines) ==="
sudo journalctl -u caddy -n 30 --no-pager

echo ""
echo "Done. Visit: https://35.238.170.247.sslip.io"
