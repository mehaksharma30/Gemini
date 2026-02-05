#!/usr/bin/env bash
# Run ON THE GCE VM via: bash /tmp/vm-fix-ports-and-caddy.sh
# Fixes port 80/443 conflict and Caddy SSL

set -e

echo "=== 1. Check what is using 80 and 443 ==="
sudo ss -lntp | grep -E ':80\b|:443\b' || true

echo ""
echo "=== 2. Stop nginx, apache2 ==="
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl stop apache2 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo systemctl disable apache2 2>/dev/null || true

echo ""
echo "=== 3. If Caddy cert acquisition failed, clear and retry ==="
sudo rm -rf /var/lib/caddy/.local/share/caddy/certificates 2>/dev/null || true
sudo rm -rf /var/lib/caddy/.local/share/caddy/acme 2>/dev/null || true

echo ""
echo "=== 4. Restart Caddy ==="
sudo systemctl restart caddy

echo ""
echo "=== 5. Wait 20s for Let's Encrypt ==="
sleep 20

echo ""
echo "=== 6. Check Caddy status and ports ==="
sudo systemctl status caddy --no-pager || true
sudo ss -lntp | grep -E ':80\b|:443\b' || true

echo ""
echo "=== 7. Caddy logs (ACME/cert) ==="
sudo journalctl -u caddy -n 30 --no-pager | grep -E 'certificate|obtain|obtained|error|fail|listening|ACME' || true

echo ""
echo "=== 8. Test HTTPS (from VM) ==="
curl -sI https://35.238.170.247.sslip.io/ 2>&1 | head -5
