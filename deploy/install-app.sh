#!/usr/bin/env bash
# Install + build the app. Run as the atano user from the repo root.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Build backend ──
cd backend
npm install
npm run build
cd ..

# ── Build frontend ──
cd frontend
npm install
npm run build
cd ..

# ── Ensure data dir is owned by atano so the service can seed clients.json ──
# The Node process writes calls.json + clients.json here. If install is
# ever invoked under sudo we want the dir owned by the runtime user.
mkdir -p backend/data
if command -v chown >/dev/null 2>&1; then
  sudo chown -R atano:atano backend/data || true
fi

# ── Check .env exists ──
if [[ ! -f backend/.env ]]; then
  echo ""
  echo "⚠️  backend/.env is missing. Copy backend/.env.example and fill it in:"
  echo "    cp backend/.env.example backend/.env"
  echo "    nano backend/.env"
  exit 1
fi

# ── Install + start systemd service ──
sudo cp deploy/atano-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable atano-backend
sudo systemctl restart atano-backend

# ── Install + start Caddy ──
# Caddy reads /etc/caddy/Caddyfile. We symlink ours so updates flow through.
sudo cp "$REPO_ROOT/Caddyfile" /etc/caddy/Caddyfile

# CADDY_DOMAIN env var needs to be set before reload — read from backend/.env's PUBLIC_URL
PUBLIC_URL=$(grep "^PUBLIC_URL=" backend/.env | cut -d= -f2-)
CADDY_DOMAIN=$(echo "$PUBLIC_URL" | sed -e 's|https\?://||' -e 's|/.*||')
echo "CADDY_DOMAIN=$CADDY_DOMAIN" | sudo tee /etc/default/caddy
sudo systemctl restart caddy

echo ""
echo "✅ Backend running. Check: sudo systemctl status atano-backend"
echo "✅ Caddy proxying $CADDY_DOMAIN → :3000"
echo "✅ Health check: curl https://$CADDY_DOMAIN/health"
