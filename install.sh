#!/usr/bin/env bash
# AI Agent Platform - installer
# Run this ON YOUR UBUNTU VPS as a user with sudo access:
#   chmod +x install.sh && ./install.sh
set -euo pipefail

APP_DIR="/opt/ai-agent"
SERVICE_NAME="ai-agent"
APP_USER="aiagent"

echo "== AI Agent Platform installer =="

# 1. Check Ubuntu version
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "Detected OS: $PRETTY_NAME"
  if [ "${ID:-}" != "ubuntu" ]; then
    echo "WARNING: this installer targets Ubuntu. Continuing anyway."
  fi
else
  echo "WARNING: could not detect OS. Continuing anyway."
fi

# 2. Check RAM
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
echo "Detected RAM: ${TOTAL_RAM_MB}MB"
if [ "$TOTAL_RAM_MB" -lt 900 ]; then
  echo "WARNING: less than ~1GB RAM detected. The platform is tuned for ~1GB but headroom matters."
fi

# 3. Install dependencies (Node.js LTS + build tools for better-sqlite3's native module)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]; then
  echo "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "Node.js already installed: $(node -v)"
fi

sudo apt-get update -y
sudo apt-get install -y build-essential python3 git nginx sqlite3 zip

# 4. Create application user
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  echo "Creating application user '$APP_USER'..."
  sudo useradd -r -m -s /usr/sbin/nologin "$APP_USER"
fi

# 5. Create application directories (do not touch existing data on upgrades)
sudo mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/backend" ]; then
  echo "Existing installation detected at $APP_DIR - preserving data/ and workspaces/."
fi
sudo mkdir -p "$APP_DIR/backend" "$APP_DIR/frontend"

# 6. Copy application files (assumes this script is run from the project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo rsync -a --exclude node_modules --exclude dist --exclude data --exclude workspaces --exclude logs \
  "$SCRIPT_DIR/backend/" "$APP_DIR/backend/"
sudo rsync -a "$SCRIPT_DIR/frontend/" "$APP_DIR/frontend/"

# 7. Install backend dependencies
cd "$APP_DIR/backend"
sudo -u "$APP_USER" npm install --omit=dev --include=dev # dev deps needed for tsc build step below
sudo -u "$APP_USER" npm run build
sudo npm prune --omit=dev # drop dev deps after build to save disk/RAM

# 8. .env setup
if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "Creating .env from template..."
  sudo cp "$SCRIPT_DIR/backend/.env.example" "$APP_DIR/backend/.env"
  SESSION_SECRET=$(openssl rand -hex 32)
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  sudo sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" "$APP_DIR/backend/.env"
  sudo sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${ENCRYPTION_KEY}/" "$APP_DIR/backend/.env"
  echo ""
  echo "Set an initial admin password now (used only on first boot):"
  read -r -s -p "Admin password for user 'admin': " ADMIN_PW
  echo ""
  sudo sed -i "s/^INITIAL_ADMIN_PASSWORD=.*/INITIAL_ADMIN_PASSWORD=${ADMIN_PW}/" "$APP_DIR/backend/.env"
else
  echo ".env already exists - leaving it untouched."
fi
sudo chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
# .env is owned by root: systemd reads it (EnvironmentFile) before dropping privileges, so code the agents run
# as the service user cannot read your secrets from disk.
sudo chown root:root "$APP_DIR/backend/.env"
sudo chmod 600 "$APP_DIR/backend/.env"

# 9. Initialize SQLite (migrations run automatically on first start, via src/db/index.ts)

# 10. systemd service
sudo cp "$SCRIPT_DIR/deploy/ai-agent.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

# 11. Start service
sudo systemctl restart "$SERVICE_NAME"
sleep 2
sudo systemctl status "$SERVICE_NAME" --no-pager || true

# 12. Display URL
echo ""
echo "================================================================"
echo " AI Agent Platform installed."
echo " Local URL: http://127.0.0.1:3000"
echo ""
echo " Next steps:"
echo "  1. Copy deploy/nginx.conf.example to /etc/nginx/sites-available/ai-agent,"
echo "     set your domain, enable it, then run: sudo certbot --nginx -d your-domain"
echo "  2. Log in with username 'admin' and the password you just set."
echo "  3. Go to API Providers and add your NVIDIA / OpenRouter / Anthropic keys."
echo ""
echo " Service management:"
echo "   sudo systemctl status ${SERVICE_NAME}"
echo "   sudo systemctl restart ${SERVICE_NAME}"
echo "   sudo journalctl -u ${SERVICE_NAME} -f"
echo "================================================================"
