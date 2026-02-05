# MindMemos – Fresh GCE Deployment Plan

One VM, trusted HTTPS, no mixed content, mic works.

---

## A) DELETE OLD INFRA

```bash
# Delete both VMs
gcloud compute instances delete mindmemos-https mindmemos-server \
  --zone=us-central1-a \
  --project=mindmemosg3 \
  --quiet

# List firewall rules (find any that expose 3000)
gcloud compute firewall-rules list --project=mindmemosg3 --format="table(name,allowed,targetTags)"

# Delete rules that allow tcp:3000 to the world (if present)
gcloud compute firewall-rules delete allow-mindmemos-http --project=mindmemosg3 --quiet 2>/dev/null || true

# Confirm no VMs left
gcloud compute instances list --project=mindmemosg3
```

---

## B) CREATE NEW VM

```bash
gcloud compute instances create mindmemos-prod \
  --zone=us-central1-a \
  --project=mindmemosg3 \
  --machine-type=e2-medium \
  --boot-disk-size=20GB \
  --boot-disk-type=pd-standard \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=http-server

# Get the new external IP
gcloud compute instances describe mindmemos-prod \
  --zone=us-central1-a \
  --project=mindmemosg3 \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

Save the IP as `NEW_IP` for the rest of the steps. Domain will be `NEW_IP.sslip.io`.

---

## C) FIREWALL RULES

```bash
# Allow HTTP (Let's Encrypt ACME) and HTTPS only. DO NOT open 3000.
gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server \
  --project=mindmemosg3 \
  2>/dev/null || true

gcloud compute firewall-rules create allow-https \
  --allow=tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server \
  --project=mindmemosg3 \
  2>/dev/null || true
```

---

## D) INSTALL DOCKER + CADDY ON THE VM

```bash
# Replace NEW_IP with your VM's external IP from step B
gcloud compute ssh mindmemos-prod \
  --zone=us-central1-a \
  --project=mindmemosg3 \
  --command='sudo bash -s' << 'REMOTE_SCRIPT'
set -e
apt-get update -y
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker

apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

mkdir -p /opt/mindmemos
docker network create mindmemos-net 2>/dev/null || true
echo "Docker and Caddy installed."
REMOTE_SCRIPT
```

---

## E) RUN THE SERVER CONTAINER

**Fill in:** `MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`. For Speech/TTS: copy service account JSON to `/opt/mindmemos/credentials.json`, or use VM service account (with Speech-to-Text + Text-to-Speech roles).

```bash
# From Mac: copy credentials to VM (if using JSON key)
# gcloud compute scp /path/to/your-service-account.json mindmemos-prod:/opt/mindmemos/credentials.json --zone=us-central1-a --project=mindmemosg3

# Copy and run the container script (edit secrets in script first)
gcloud compute scp scripts/run-mindmemos-container.sh mindmemos-prod:/tmp/ --zone=us-central1-a --project=mindmemosg3
gcloud compute ssh mindmemos-prod --zone=us-central1-a --project=mindmemosg3
# On VM: edit /tmp/run-mindmemos-container.sh, set MONGODB_URI, JWT_SECRET, GEMINI_API_KEY, then:
# chmod +x /tmp/run-mindmemos-container.sh && sudo bash /tmp/run-mindmemos-container.sh
```

**Or run manually (replace YOUR_* with real values):**

```bash
gcloud compute ssh mindmemos-prod --zone=us-central1-a --project=mindmemosg3 --command='
NEW_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
docker pull us-central1-docker.pkg.dev/mindmemosg3/mindmemos/server:latest
docker stop mindmemos 2>/dev/null || true
docker rm mindmemos 2>/dev/null || true
docker run -d --name mindmemos --restart=unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e MONGODB_URI="YOUR_MONGODB_URI" \
  -e JWT_SECRET="YOUR_JWT_SECRET" \
  -e GEMINI_API_KEY="YOUR_GEMINI_API_KEY" \
  -e FRONTEND_URL="https://${NEW_IP}.sslip.io" \
  us-central1-docker.pkg.dev/mindmemosg3/mindmemos/server:latest
'
```

---

## F) CADDYFILE

Node serves both `/api` and the Angular SPA from `public-app`. Caddy proxies everything to `127.0.0.1:3000`.

```bash
# Replace NEW_IP with your VM external IP before running
gcloud compute ssh mindmemos-prod --zone=us-central1-a --project=mindmemosg3 --command='
NEW_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
sudo tee /etc/caddy/Caddyfile << EOF
${NEW_IP}.sslip.io {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl enable caddy
sudo journalctl -u caddy -n 50 --no-pager
'
```

**Exact Caddyfile content** (replace `NEW_IP` with your actual IP, e.g. `35.123.45.67`):

```
35.123.45.67.sslip.io {
    reverse_proxy 127.0.0.1:3000
}
```

---

## G) FRONTEND apiUrl FIX + REBUILD + DEPLOY

`client/src/environments/environment.prod.ts` must have:

```typescript
export const environment = {
  production: true,
  apiUrl: '/api',
  voiceGatewayUrl: '',
  azureSpeechKey: '',
  azureSpeechRegion: '',
};
```

**Rebuild and push image (from your Mac):**

```bash
cd /Users/amanverma/Documents/Gemini3_Hackathon/Gemini

# Ensure apiUrl is /api (already correct in env.prod)
grep "apiUrl:" client/src/environments/environment.prod.ts
# Must show: apiUrl: '/api',

./scripts/deploy-gce.sh
```

**Update container on VM:**

```bash
gcloud compute ssh mindmemos-prod --zone=us-central1-a --project=mindmemosg3 --command='
docker pull us-central1-docker.pkg.dev/mindmemosg3/mindmemos/server:latest
docker restart mindmemos
'
```

---

## H) FINAL VERIFICATION

```bash
# Replace NEW_IP with your VM IP
NEW_IP=<your-vm-external-ip>

# HTTP -> HTTPS redirect
curl -sI "http://${NEW_IP}.sslip.io" | head -3

# HTTPS response
curl -sI "https://${NEW_IP}.sslip.io" | head -5

# API health
curl -sI "https://${NEW_IP}.sslip.io/api/health" | head -5

# Login (expect 401 for bad creds)
curl -s -X POST "https://${NEW_IP}.sslip.io/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"x","password":"y"}'
```

**In Chrome:**
1. Open `https://NEW_IP.sslip.io`
2. Hard refresh (Cmd+Shift+R) or Incognito
3. Check: no "Not Secure", no mixed content, login POST to `https://.../api/auth/login`
4. Panic page: mic permission prompt should appear

---

## DEBUGGING LET'S ENCRYPT

If cert fails:

```bash
# Verify sslip.io resolves
dig +short NEW_IP.sslip.io
# Should return NEW_IP

# Check ports from outside
nc -zv NEW_IP 80
nc -zv NEW_IP 443

# On VM: Caddy logs
sudo journalctl -u caddy -n 100 --no-pager

# On VM: port listeners
sudo ss -lntp | grep -E ':80|:443'
```
