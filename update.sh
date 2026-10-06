#!/usr/bin/env bash
# Updates an existing installation without touching data/, workspaces/, or .env
set -euo pipefail
APP_DIR="/opt/ai-agent"
SERVICE_NAME="ai-agent"
APP_USER="aiagent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Backing up database..."
sudo mkdir -p "$APP_DIR/backups"
sudo cp "$APP_DIR/backend/data/app.db" "$APP_DIR/backups/app.db.$(date +%Y%m%d%H%M%S).bak" || true

echo "Syncing application files (preserving data/workspaces/logs/.env)..."
sudo rsync -a --exclude node_modules --exclude dist --exclude data --exclude workspaces --exclude logs --exclude .env \
  "$SCRIPT_DIR/backend/" "$APP_DIR/backend/"
sudo rsync -a "$SCRIPT_DIR/frontend/" "$APP_DIR/frontend/"

cd "$APP_DIR/backend"
sudo -u "$APP_USER" npm install --include=dev
sudo -u "$APP_USER" npm run build
sudo npm prune --omit=dev

sudo chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
[ -f "$APP_DIR/backend/.env" ] && sudo chown root:root "$APP_DIR/backend/.env" && sudo chmod 600 "$APP_DIR/backend/.env"

echo "Restarting service (migrations run automatically on boot)..."
sudo systemctl restart "$SERVICE_NAME"
sleep 2
sudo systemctl status "$SERVICE_NAME" --no-pager || true
echo "Update complete."
