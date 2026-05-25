#!/usr/bin/env bash
# Run this ON the GCP VM after SSH-ing in.
# Idempotent — safe to re-run if something fails halfway.
set -euo pipefail

# ── 1. Create the atano user if it doesn't exist ──
if ! id atano &>/dev/null; then
  sudo useradd -m -s /bin/bash atano
  sudo usermod -aG sudo atano
fi

# ── 2. Install Node 20 via NodeSource ──
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# ── 3. Install Caddy via official repo ──
if ! command -v caddy &>/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
fi

# ── 4. Install build tools (some npm packages need them) ──
sudo apt-get install -y build-essential git

# ── 5. Make sure log dirs exist with right perms ──
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy || true
sudo touch /var/log/atano-backend.log
sudo chown atano:atano /var/log/atano-backend.log

echo "VM bootstrap complete."
echo "Next steps:"
echo "  1. su - atano"
echo "  2. git clone <your-repo-url>"
echo "  3. cd atano-voice-agent && bash deploy/install-app.sh"
